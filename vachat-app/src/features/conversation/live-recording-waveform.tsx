import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

const BAR_WIDTH = 2;
const BAR_GAP = 2;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const MIN_BAR = 10;
const MAX_BAR = 34;
const MIN_COUNT = 24;
const MAX_COUNT = 120;

type LiveRecordingWaveformProps = {
  level: number;
  running?: boolean;
};

export function LiveRecordingWaveform({ level, running = true }: LiveRecordingWaveformProps) {
  const [width, setWidth] = useState(0);
  const count = Math.min(
    MAX_COUNT,
    Math.max(MIN_COUNT, width > 0 ? Math.floor(width / BAR_STEP) : MIN_COUNT),
  );
  const [bars, setBars] = useState(() => Array.from({ length: count }, () => MIN_BAR));
  const levelRef = useRef(level);
  const countRef = useRef(count);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    countRef.current = count;
    setBars((current) => {
      if (current.length === count) return current;
      if (current.length < count) {
        return [...Array.from({ length: count - current.length }, () => MIN_BAR), ...current];
      }
      return current.slice(current.length - count);
    });
  }, [count]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const amp = Math.max(0.28, Math.min(1, levelRef.current * 1.35));
      setBars((current) => {
        const size = countRef.current;
        const next =
          current.length === size ? current.slice(1) : current.slice(Math.max(0, current.length - size + 1));
        const jitter = 0.72 + Math.random() * 0.4;
        next.push(MIN_BAR + (MAX_BAR - MIN_BAR) * amp * jitter);
        return next;
      });
    }, 45);
    return () => clearInterval(timer);
  }, [running]);

  function onLayout(event: LayoutChangeEvent) {
    const next = Math.floor(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  }

  return (
    <View onLayout={onLayout} style={styles.row}>
      {bars.map((height, index) => (
        <View key={index} style={styles.track}>
          <Animated.View style={[styles.bar, { transform: [{ scaleY: height / MAX_BAR }] }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: BAR_GAP,
    height: MAX_BAR,
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  track: {
    alignItems: 'center',
    height: MAX_BAR,
    justifyContent: 'center',
    width: BAR_WIDTH,
  },
  bar: {
    backgroundColor: 'rgba(17, 27, 33, 0.52)',
    borderRadius: 1,
    height: MAX_BAR,
    transform: [{ scaleY: MIN_BAR / MAX_BAR }],
    transitionDuration: '90ms',
    transitionProperty: 'transform',
    transitionTimingFunction: 'linear',
    width: BAR_WIDTH,
  },
});
