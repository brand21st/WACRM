import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRecordBeepWav, playRecordBeep } from "./voice-record-beep";

describe("buildRecordBeepWav", () => {
  it("writes a non-silent mono PCM WAV", async () => {
    const blob = buildRecordBeepWav("start");
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBeGreaterThan(44);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WAVE");
    let peak = 0;
    for (let i = 44; i + 1 < bytes.length; i += 2) {
      const sample = bytes[i]! | (bytes[i + 1]! << 8);
      const signed = sample > 32767 ? sample - 65536 : sample;
      peak = Math.max(peak, Math.abs(signed));
    }
    expect(peak).toBeGreaterThan(8000);
  });
});

describe("playRecordBeep", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays through HTMLAudio in the same turn", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const appendChild = vi.fn();
    vi.stubGlobal("document", { body: { appendChild } });
    vi.stubGlobal(
      "Audio",
      class {
        volume = 1;
        preload = "";
        style = { display: "" };
        play = play;
        addEventListener = vi.fn();
        setAttribute = vi.fn();
        remove = vi.fn();
      },
    );
    playRecordBeep("stop");
    expect(play).toHaveBeenCalledTimes(1);
    expect(appendChild).toHaveBeenCalledTimes(1);
  });
});
