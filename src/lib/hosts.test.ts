import { afterEach, describe, expect, it } from "vitest";
import {
  APP_ORIGIN,
  appOrigin,
  isAppHost,
  isCrmPath,
  isLandingHost,
  isWwwAppHost,
  normalizeHost,
} from "./hosts";

describe("hosts", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("normalizes hosts and strips ports", () => {
    expect(normalizeHost("WWW.Vachat.in:443")).toBe("www.vachat.in");
    expect(normalizeHost(null)).toBe("");
  });

  it("classifies landing vs app hosts", () => {
    expect(isLandingHost("vachat.in")).toBe(true);
    expect(isLandingHost("www.vachat.in")).toBe(true);
    expect(isLandingHost("cloud.vachat.in")).toBe(false);
    expect(isAppHost("cloud.vachat.in")).toBe(true);
    expect(isAppHost("www.cloud.vachat.in")).toBe(true);
    expect(isWwwAppHost("www.cloud.vachat.in")).toBe(true);
    expect(isAppHost("localhost")).toBe(false);
  });

  it("treats CRM surfaces as app paths", () => {
    expect(isCrmPath("/login")).toBe(true);
    expect(isCrmPath("/dashboard")).toBe(true);
    expect(isCrmPath("/inbox/abc")).toBe(true);
    expect(isCrmPath("/super-admin/packages")).toBe(true);
    expect(isCrmPath("/")).toBe(false);
    expect(isCrmPath("/privacy")).toBe(false);
    expect(isCrmPath("/terms")).toBe(false);
  });

  it("prefers NEXT_PUBLIC_SITE_URL for the app origin", () => {
    expect(appOrigin()).toBe(APP_ORIGIN);
    process.env.NEXT_PUBLIC_SITE_URL = "https://cloud.vachat.in/";
    expect(appOrigin()).toBe("https://cloud.vachat.in");
  });
});
