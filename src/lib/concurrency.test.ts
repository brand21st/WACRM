import { describe, expect, it } from "vitest";
import { createSemaphore, mapPool } from "./concurrency";

describe("createSemaphore", () => {
  it("never runs more than max tasks at once", async () => {
    const sem = createSemaphore(2);
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        sem.run(async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 15));
          active -= 1;
        }),
      ),
    );
    expect(maxActive).toBe(2);
  });
});

describe("mapPool", () => {
  it("preserves order while capping concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBe(2);
  });
});
