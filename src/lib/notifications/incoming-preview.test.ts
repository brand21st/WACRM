import { describe, expect, it } from "vitest";
import {
  contactDisplayName,
  incomingPreviewKind,
  incomingPreviewText,
} from "./incoming-preview";

const LABELS = {
  image: "Photo",
  video: "Video",
  audio: "Voice message",
  document: "Document",
  location: "Location",
  interactive: "Reply",
  default: "New message",
} as const;

describe("incomingPreviewKind", () => {
  it("prefers non-empty text over the content type", () => {
    expect(incomingPreviewKind("image", "caption here")).toBe("text");
    expect(incomingPreviewKind("interactive", "Yes")).toBe("text");
  });

  it("maps media types when there is no text", () => {
    expect(incomingPreviewKind("image", null)).toBe("image");
    expect(incomingPreviewKind("audio", "  ")).toBe("audio");
    expect(incomingPreviewKind("video", undefined)).toBe("video");
    expect(incomingPreviewKind("document", "")).toBe("document");
    expect(incomingPreviewKind("location", null)).toBe("location");
    expect(incomingPreviewKind("interactive", null)).toBe("interactive");
  });

  it("falls back for unknown / empty types", () => {
    expect(incomingPreviewKind("template", null)).toBe("default");
    expect(incomingPreviewKind(undefined, null)).toBe("default");
  });
});

describe("incomingPreviewText", () => {
  it("returns trimmed text and ellipsizes long bodies", () => {
    expect(incomingPreviewText("text", "  hello  ", LABELS)).toBe("hello");
    const long = "x".repeat(160);
    const out = incomingPreviewText("text", long, LABELS);
    expect(out).toBe(`${"x".repeat(137)}…`);
  });

  it("uses the placeholder for media kinds", () => {
    expect(incomingPreviewText("image", null, LABELS)).toBe("Photo");
    expect(incomingPreviewText("audio", "", LABELS)).toBe("Voice message");
  });
});

describe("contactDisplayName", () => {
  it("prefers name, then phone", () => {
    expect(contactDisplayName("Ada", "+1555")).toBe("Ada");
    expect(contactDisplayName("  ", "+1555")).toBe("+1555");
    expect(contactDisplayName(null, null)).toBeNull();
  });
});
