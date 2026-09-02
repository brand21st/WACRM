import { describe, expect, it } from "vitest";
import {
  barsThatFit,
  peaksFromChannel,
  resamplePeaks,
  WA_BAR_GAP,
  WA_BAR_WIDTH,
  WA_WAVE_BARS,
} from "./voice-waveform";

describe("peaksFromChannel", () => {
  it("returns a quiet envelope for empty audio", () => {
    const peaks = peaksFromChannel(new Float32Array(0));
    expect(peaks).toHaveLength(WA_WAVE_BARS);
    expect(peaks.every((p) => p === 0.12)).toBe(true);
  });

  it("normalizes a loud spike against quieter frames", () => {
    const channel = new Float32Array(WA_WAVE_BARS * 4);
    for (let i = 0; i < 4; i++) channel[i] = 1;
    for (let i = 8; i < 12; i++) channel[i] = 0.2;
    const peaks = peaksFromChannel(channel);
    expect(peaks[0]).toBeCloseTo(1);
    expect(peaks[2]).toBeGreaterThan(0.12);
    expect(peaks[2]).toBeLessThan(1);
  });
});

describe("resamplePeaks", () => {
  it("returns the same array when the count matches", () => {
    const peaks = [0.2, 0.8, 0.4];
    expect(resamplePeaks(peaks, 3)).toBe(peaks);
  });

  it("stretches a short envelope to more bars", () => {
    const out = resamplePeaks([0.2, 1], 4);
    expect(out).toHaveLength(4);
    expect(out[0]).toBe(0.2);
    expect(out[3]).toBe(1);
  });

  it("returns empty when asked for no bars", () => {
    expect(resamplePeaks([0.5], 0)).toEqual([]);
  });
});

describe("barsThatFit", () => {
  it("packs 2px bars with 2px gaps", () => {
    expect(barsThatFit(200)).toBe(
      Math.floor((200 + WA_BAR_GAP) / (WA_BAR_WIDTH + WA_BAR_GAP)),
    );
  });

  it("never drops below 24 bars", () => {
    expect(barsThatFit(10)).toBe(24);
  });
});
