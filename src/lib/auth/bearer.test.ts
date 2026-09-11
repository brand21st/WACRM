import { describe, expect, it } from "vitest";
import { generateApiKey } from "@/lib/api-keys/keys";
import { parseBearerAccessToken } from "./bearer";

describe("parseBearerAccessToken", () => {
  it("extracts a user JWT from Authorization", () => {
    expect(parseBearerAccessToken("Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")).toBe(
      "eyJhbGciOiJIUzI1NiJ9.payload.sig",
    );
  });

  it("is case-insensitive on the Bearer scheme", () => {
    expect(parseBearerAccessToken("bearer user-jwt-token")).toBe("user-jwt-token");
  });

  it("returns null for missing or malformed headers", () => {
    expect(parseBearerAccessToken(null)).toBeNull();
    expect(parseBearerAccessToken(undefined)).toBeNull();
    expect(parseBearerAccessToken("")).toBeNull();
    expect(parseBearerAccessToken("Basic abc")).toBeNull();
    expect(parseBearerAccessToken("Bearer")).toBeNull();
  });

  it("rejects account API keys so they cannot authenticate as a user", () => {
    expect(parseBearerAccessToken(`Bearer ${generateApiKey().plaintext}`)).toBeNull();
    expect(parseBearerAccessToken("Bearer wacrm_live_not_a_jwt")).toBeNull();
  });
});
