import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

type VoiceWaveformProps = {
  peaks: number[];
  progress: number;
  barColor: string;
  playedColor: string;
  align?: 'center' | 'flex-end';
};

const BAR_WIDTH = 2;
const BAR_GAP = 2;
const MIN_BAR = 4;
const MAX_BAR = 28;

export function VoiceWaveform({
  peaks,
  progress,
  barColor,
  playedColor,
  align = 'flex-end',
}: VoiceWaveformProps) {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const playedBars = Math.floor(clampedProgress * peaks.length);

  const bars = useMemo(
    () =>
      peaks.map((peak, index) => ({
        height: MIN_BAR + (MAX_BAR - MIN_BAR) * peak,
        played: index < playedBars,
      })),
    [peaks, playedBars],
  );

  return (
    <View style={[styles.row, { alignItems: align }]}>
      {bars.map((bar, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            {
              height: bar.height,
              backgroundColor: bar.played ? playedColor : barColor,
            },
          ]}
        />
      ))}
    </View>
  );
}

export const VOICE_WAVE_STEP = BAR_WIDTH + BAR_GAP;

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: BAR_GAP,
    height: MAX_BAR,
    justifyContent: 'flex-start',
    overflow: 'hidden',
    width: '100%',
  },
  bar: {
    borderRadius: 1,
    width: BAR_WIDTH,
  },
});
