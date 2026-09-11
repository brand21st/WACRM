import { describe, expect, it } from 'vitest';

import { createSingleFlight } from './single-flight';

describe('createSingleFlight', () => {
  it('shares one in-flight call across concurrent callers', async () => {
    let runs = 0;
    const gated = createSingleFlight(async () => {
      runs += 1;
      await Promise.resolve();
      return runs;
    });

    const [a, b, c] = await Promise.all([gated(), gated(), gated()]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(c).toBe(1);
    expect(runs).toBe(1);
  });

  it('allows a new run after the first finishes', async () => {
    let runs = 0;
    const gated = createSingleFlight(async () => {
      runs += 1;
      return runs;
    });

    await gated();
    expect(await gated()).toBe(2);
  });
});
