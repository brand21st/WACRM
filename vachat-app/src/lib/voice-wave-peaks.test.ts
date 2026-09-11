import { describe, expect, it } from 'vitest';

import { peaksFromUri } from './voice-wave-peaks';

describe('peaksFromUri', () => {
  it('returns a stable envelope for the same uri', () => {
    const first = peaksFromUri('https://cdn.example/voice.ogg');
    const second = peaksFromUri('https://cdn.example/voice.ogg');
    expect(first).toEqual(second);
  });

  it('returns normalized peaks between 0.12 and 1', () => {
    const peaks = peaksFromUri('https://cdn.example/another.ogg', 24);
    expect(peaks).toHaveLength(24);
    for (const peak of peaks) {
      expect(peak).toBeGreaterThanOrEqual(0.12);
      expect(peak).toBeLessThanOrEqual(1);
    }
  });
});
