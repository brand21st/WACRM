import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { SymbolView } from 'expo-symbols';
import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { LiveRecordingWaveform } from '@/features/conversation/live-recording-waveform';
import { VoiceWaveform } from '@/features/conversation/voice-waveform';
import { useTheme } from '@/hooks/use-theme';
import { loadVoicePeaks, peaksFromUri } from '@/lib/voice-wave-peaks';

type RecordingBarProps = {
  durationMs: number;
  meterLevel: number;
  isRecording: boolean;
  draftUri: string | null;
  busy?: boolean;
  onCancel: () => void;
  onPause: () => void;
  onSend: () => void;
};

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function ScalePressable({
  accessibilityLabel,
  disabled,
  onPress,
  style,
  pulse,
  children,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  onPress: () => void;
  style?: object;
  pulse?: boolean;
  children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      pressRetentionOffset={16}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}>
      <Animated.View
        style={[
          styles.scaleBase,
          style,
          pulse && !pressed ? styles.pulse : null,
          pressed && styles.pressed,
          disabled && styles.dim,
        ]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
function RecordingChrome({
  clock,
  wave,
  busy,
  centerLabel,
  centerPlaying,
  pulseCenter,
  onCancel,
  onCenter,
  onSend,
}: {
  clock: string;
  wave: ReactNode;
  busy: boolean;
  centerLabel: string;
  centerPlaying: boolean;
  pulseCenter?: boolean;
  onCancel: () => void;
  onCenter: () => void;
  onSend: () => void;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();

  return (
    <View style={[styles.wrap, { backgroundColor: theme.chatWallpaper }]}>
      <View style={styles.waveRow}>
        <Text style={styles.clock}>{clock}</Text>
        <View style={styles.wave}>{wave}</View>
      </View>

      <View style={styles.actions}>
        <ScalePressable
          accessibilityLabel="Delete recording"
          disabled={busy}
          onPress={onCancel}
          style={styles.sideSlot}>
          <SymbolView
            name={{ android: 'delete_outline', ios: 'trash', web: 'delete_outline' }}
            size={26}
            tintColor="#111B21"
          />
        </ScalePressable>

        <ScalePressable
          accessibilityLabel={centerLabel}
          disabled={busy}
          onPress={onCenter}
          pulse={pulseCenter && !reduced}
          style={styles.pauseBtn}>
          <SymbolView
            name={{
              android: centerPlaying ? 'pause' : 'play_arrow',
              ios: centerPlaying ? 'pause.fill' : 'play.fill',
              web: centerPlaying ? 'pause' : 'play_arrow',
            }}
            size={22}
            tintColor="#FFFFFF"
          />
        </ScalePressable>

        <ScalePressable
          accessibilityLabel="Send voice note"
          disabled={busy}
          onPress={onSend}
          style={styles.sendBtn}>
          <SymbolView
            name={{ android: 'send', ios: 'paperplane.fill', web: 'send' }}
            size={18}
            tintColor="#FFFFFF"
          />
        </ScalePressable>
      </View>
    </View>
  );
}

function DraftWave({ uri, progress }: { uri: string; progress: number }) {
  const [peaks, setPeaks] = useState(() => peaksFromUri(uri));

  useEffect(() => {
    let cancelled = false;
    void loadVoicePeaks(uri).then((next) => {
      if (!cancelled) setPeaks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const playing = progress > 0.02;
  return (
    <VoiceWaveform
      align="center"
      barColor="rgba(17, 27, 33, 0.38)"
      peaks={peaks}
      playedColor={playing ? '#111B21' : 'rgba(17, 27, 33, 0.38)'}
      progress={progress}
    />
  );
}

function DraftRecordingBar({
  uri,
  durationMs,
  busy,
  onCancel,
  onSend,
}: {
  uri: string;
  durationMs: number;
  busy: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const currentTime = Number.isFinite(status.currentTime) ? status.currentTime : 0;
  const durationSeconds =
    Number.isFinite(status.duration) && status.duration > 0 ? status.duration : durationMs / 1000;
  const progress = durationSeconds > 0 ? Math.min(1, Math.max(0, currentTime / durationSeconds)) : 0;
  const playing = status.playing;
  const clockSeconds = playing || currentTime > 0.05 ? currentTime : durationSeconds;

  function onCenter() {
    if (busy) return;
    if (status.playing) {
      player.pause();
      return;
    }
    if (durationSeconds > 0 && currentTime >= durationSeconds - 0.05) {
      void player.seekTo(0);
    }
    player.play();
  }

  return (
    <RecordingChrome
      busy={busy}
      centerLabel={playing ? 'Pause preview' : 'Play recording'}
      centerPlaying={playing}
      clock={formatClock(clockSeconds)}
      onCancel={onCancel}
      onCenter={onCenter}
      onSend={onSend}
      wave={<DraftWave progress={progress} uri={uri} />}
    />
  );
}

export function RecordingBar({
  durationMs,
  meterLevel,
  isRecording,
  draftUri,
  busy = false,
  onCancel,
  onPause,
  onSend,
}: RecordingBarProps) {
  if (draftUri && !isRecording) {
    return (
      <DraftRecordingBar
        busy={busy}
        durationMs={durationMs}
        onCancel={onCancel}
        onSend={onSend}
        uri={draftUri}
      />
    );
  }

  return (
    <RecordingChrome
      busy={busy}
      centerLabel="Pause recording"
      centerPlaying
      pulseCenter
      clock={formatClock(Math.floor(durationMs / 1000))}
      onCancel={onCancel}
      onCenter={onPause}
      onSend={onSend}
      wave={<LiveRecordingWaveform level={meterLevel} running={isRecording} />}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  waveRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 36,
  },
  clock: {
    color: '#111B21',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    minWidth: 40,
  },
  wave: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  sideSlot: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pauseBtn: {
    alignItems: 'center',
    backgroundColor: '#FF2D55',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sendBtn: {
    alignItems: 'center',
    backgroundColor: '#111B21',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  scaleBase: {
    transform: [{ scale: 1 }],
    transitionDuration: '120ms',
    transitionProperty: 'transform',
    transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
  pulse: {
    animationDirection: 'alternate',
    animationDuration: '1100ms',
    animationIterationCount: 'infinite',
    animationName: {
      from: { transform: [{ scale: 1 }] },
      to: { transform: [{ scale: 1.05 }] },
    },
    animationTimingFunction: 'ease-in-out',
  },
  dim: {
    opacity: 0.65,
  },
});
