import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadMedia, META_MEDIA_DOWNLOAD_CONCURRENCY } from "./meta-api";

function jsonResponse(status: number, body: Record<string, unknown> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "audio/ogg" },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    json: async () => body,
  };
}

describe("downloadMedia", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries a 500 and then returns the bytes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500))
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal("fetch", fetchImpl);

    const pending = downloadMedia({
      downloadUrl: "https://lookaside.fbsbx.com/whatsapp/abc",
      accessToken: "tok",
    });
    await vi.runAllTimersAsync();
    const out = await pending;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.buffer.byteLength).toBe(3);
    expect(out.contentType).toBe("audio/ogg");
  });

  it("caps overlapping Meta CDN downloads", async () => {
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
        return jsonResponse(200);
      }),
    );

    const jobs = Array.from({ length: 6 }, (_, i) =>
      downloadMedia({
        downloadUrl: `https://lookaside.fbsbx.com/${i}`,
        accessToken: "tok",
      }),
    );
    await vi.runAllTimersAsync();
    await Promise.all(jobs);

    expect(maxActive).toBeLessThanOrEqual(META_MEDIA_DOWNLOAD_CONCURRENCY);
    expect(maxActive).toBeGreaterThan(0);
  });
});
