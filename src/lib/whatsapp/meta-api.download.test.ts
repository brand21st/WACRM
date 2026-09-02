import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadMedia,
  downloadWhatsAppMedia,
  META_MEDIA_DOWNLOAD_CONCURRENCY,
  META_MEDIA_DOWNLOAD_USER_AGENT,
} from "./meta-api";

function jsonResponse(
  status: number,
  opts: { contentType?: string; location?: string | null } = {},
) {
  const contentType = opts.contentType ?? "audio/ogg";
  const location = opts.location ?? null;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        const key = name.toLowerCase();
        if (key === "content-type") return contentType;
        if (key === "location") return location;
        return null;
      },
    },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    json: async () => ({}),
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

  it("sends a curl User-Agent so lookaside does not 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal("fetch", fetchImpl);

    await downloadMedia({
      downloadUrl: "https://lookaside.fbsbx.com/whatsapp/abc",
      accessToken: "tok",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://lookaside.fbsbx.com/whatsapp/abc",
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({
          Authorization: "Bearer tok",
          "User-Agent": META_MEDIA_DOWNLOAD_USER_AGENT,
        }),
      }),
    );
  });

  it("follows a 302 while keeping the Bearer token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(302, {
          location: "https://lookaside.fbsbx.com/whatsapp/real",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal("fetch", fetchImpl);

    const out = await downloadMedia({
      downloadUrl: "https://lookaside.fbsbx.com/whatsapp/abc",
      accessToken: "tok",
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://lookaside.fbsbx.com/whatsapp/real",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
    expect(out.buffer.byteLength).toBe(3);
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

  it("refreshes the media URL between WhatsApp media-id retries", async () => {
    const graph = (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        url: `https://lookaside.fbsbx.com/${url}`,
        mime_type: "audio/ogg",
        file_size: 3,
      }),
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(graph("one"))
      .mockResolvedValueOnce(jsonResponse(500))
      .mockResolvedValueOnce(graph("two"))
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal("fetch", fetchImpl);

    const pending = downloadWhatsAppMedia({
      mediaId: "media-1",
      accessToken: "tok",
    });
    await vi.runAllTimersAsync();
    const out = await pending;

    expect(out.buffer.byteLength).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://lookaside.fbsbx.com/two",
      expect.anything(),
    );
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
