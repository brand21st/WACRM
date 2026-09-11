import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useState } from 'react';
import {
  type GestureResponderEvent,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { MessageStatusTicks } from '@/features/conversation/message-status-ticks';
import { VoiceNoteAvatar } from '@/features/conversation/voice-note-avatar';
import { VoiceWaveform } from '@/features/conversation/voice-waveform';
import { loadVoicePeaks, peaksFromUri } from '@/lib/voice-wave-peaks';
import type { Message } from '@/types/messages';

type VoiceNoteVariant = 'inbound' | 'outbound';

export type VoiceNotePlayerProps = {
  uri: string;
  durationMs?: number;
  variant?: VoiceNoteVariant;
  timeLabel?: string;
  status?: Message['status'];
  contactId?: string | null;
  name?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
};

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function resolvedDurationSeconds(duration: number, durationMs?: number): number {
  if (Number.isFinite(duration) && duration > 0) return duration;
  if (durationMs && Number.isFinite(durationMs) && durationMs > 0) {
    return durationMs / 1000;
  }
  return 0;
}

function pressOffsetX(event: GestureResponderEvent): number | null {
  const native = event.nativeEvent as {
    locationX?: number;
    offsetX?: number;
  };
  if (typeof native.locationX === 'number' && Number.isFinite(native.locationX)) {
    return native.locationX;
  }
  if (typeof native.offsetX === 'number' && Number.isFinite(native.offsetX)) {
    return native.offsetX;
  }
  return null;
}

export function VoiceNotePlayer({
  uri,
  durationMs,
  variant = 'outbound',
  timeLabel,
  status,
  contactId,
  name,
  phone,
  avatarUrl,
}: VoiceNotePlayerProps) {
  const outbound = variant === 'outbound';
  const player = useAudioPlayer(uri);
  const audioStatus = useAudioPlayerStatus(player);
  const [peaks, setPeaks] = useState<number[]>(() => peaksFromUri(uri));
  const [waveWidth, setWaveWidth] = useState(0);

  const durationSeconds = resolvedDurationSeconds(audioStatus.duration, durationMs);
  const currentTime = Number.isFinite(audioStatus.currentTime) ? audioStatus.currentTime : 0;
  const canSeek = durationSeconds > 0;
  const progress = canSeek ? Math.min(1, Math.max(0, currentTime / durationSeconds)) : 0;
  const displaySeconds =
    audioStatus.playing || currentTime > 0 ? currentTime : durationSeconds;
  const played = audioStatus.playing || progress > 0.02;
  const playBackground = !outbound && played ? '#00A884' : '#111B21';
  const playedColor = outbound ? '#111B21' : played ? '#00A884' : '#F87171';
  const barColor = 'rgba(17, 27, 33, 0.28)';
  const micColor = outbound ? '#00A884' : played ? '#00A884' : '#8696A0';

  useEffect(() => {
    let cancelled = false;
    void loadVoicePeaks(uri).then((next) => {
      if (!cancelled) setPeaks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  function togglePlayback() {
    if (audioStatus.playing) {
      player.pause();
      return;
    }
    if (
      Number.isFinite(audioStatus.duration) &&
      audioStatus.duration > 0 &&
      currentTime >= audioStatus.duration
    ) {
      player.seekTo(0);
    }
    player.play();
  }

  function seekToRatio(ratio: number) {
    if (!canSeek || !Number.isFinite(ratio)) return;
    const clamped = Math.min(1, Math.max(0, ratio));
    const next = clamped * durationSeconds;
    if (!Number.isFinite(next)) return;
    void player.seekTo(next).catch(() => {});
  }

  function onWavePress(event: GestureResponderEvent) {
    if (!canSeek || waveWidth <= 0) return;
    const locationX = pressOffsetX(event);
    if (locationX == null) return;
    seekToRatio(locationX / waveWidth);
  }

  function onWaveLayout(event: LayoutChangeEvent) {
    setWaveWidth(event.nativeEvent.layout.width);
  }

  const avatar = (
    <VoiceNoteAvatar
      contactId={contactId}
      name={name}
      phone={phone}
      avatarUrl={avatarUrl}
      micColor={micColor}
    />
  );

  const playButton = (
    <Pressable
      accessibilityLabel={audioStatus.playing ? 'Pause voice note' : 'Play voice note'}
      accessibilityRole="button"
      hitSlop={6}
      onPress={togglePlayback}
      style={[styles.playButton, { backgroundColor: playBackground }]}>
      <SymbolView
        name={{
          android: audioStatus.playing ? 'pause' : 'play_arrow',
          ios: audioStatus.playing ? 'pause.fill' : 'play.fill',
          web: audioStatus.playing ? 'pause' : 'play_arrow',
        }}
        size={18}
        tintColor="#FFFFFF"
      />
    </Pressable>
  );

  const meta = (
    <View style={styles.metaRow}>
      <ThemedText style={styles.duration}>{formatDuration(displaySeconds)}</ThemedText>
      <View style={styles.timeRow}>
        {timeLabel ? <ThemedText style={styles.time}>{timeLabel}</ThemedText> : null}
        {outbound && status ? <MessageStatusTicks color="#8696A0" status={status} /> : null}
      </View>
    </View>
  );

  return (
    <View style={styles.wrap}>
      {outbound ? avatar : null}
      {playButton}
      <View style={styles.main}>
        <Pressable
          accessibilityLabel="Seek voice note"
          accessibilityRole="button"
          disabled={!canSeek}
          onLayout={onWaveLayout}
          onPress={onWavePress}
          style={[styles.wavePress, !canSeek && styles.waveDisabled]}>
          <VoiceWaveform barColor={barColor} peaks={peaks} playedColor={playedColor} progress={progress} />
        </Pressable>
        {meta}
      </View>
      {outbound ? null : avatar}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minWidth: 248,
    paddingVertical: 2,
  },
  playButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  main: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  wavePress: {
    justifyContent: 'center',
    minHeight: 28,
    width: '100%',
  },
  waveDisabled: {
    opacity: 0.95,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 14,
  },
  duration: {
    color: '#667781',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    lineHeight: 14,
  },
  timeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  time: {
    color: '#8696A0',
    fontSize: 11,
    lineHeight: 14,
  },
});
