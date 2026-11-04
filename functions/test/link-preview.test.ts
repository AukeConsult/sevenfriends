import { describe, expect, it } from "vitest";
import { firstUrl, framingAllowed, isPrivateAddress, linkOf, playerUrl, tooMany } from "../src/link-preview";

describe("firstUrl", () => {
  it("finds the first web address and drops the punctuation that ends a sentence", () => {
    expect(firstUrl("look https://example.com/a?b=1, nice")).toBe("https://example.com/a?b=1");
    expect(firstUrl("(see http://example.com/x).")).toBe("http://example.com/x");
    expect(firstUrl("two https://one.test and https://two.test")).toBe("https://one.test/");
  });
  it("ignores other schemes, passwords in the address and plain text", () => {
    expect(firstUrl("ftp://example.com")).toBeNull();
    expect(firstUrl("javascript:alert(1)")).toBeNull();
    expect(firstUrl("https://user:pass@example.com")).toBeNull();
    expect(firstUrl("no link here")).toBeNull();
  });
});

describe("playerUrl", () => {
  it("gives the official player of a video or a song", () => {
    expect(playerUrl(new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(playerUrl(new URL("https://youtu.be/dQw4w9WgXcQ?t=3"))).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(playerUrl(new URL("https://vimeo.com/76979871"))).toBe("https://player.vimeo.com/video/76979871");
    expect(playerUrl(new URL("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x"))).toBe("https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC");
  });
  it("gives nothing for other sites or a damaged id", () => {
    expect(playerUrl(new URL("https://example.com/watch?v=dQw4w9WgXcQ"))).toBeNull();
    expect(playerUrl(new URL("https://www.youtube.com/watch?v=<script>"))).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("refuses internal addresses", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const a of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946"]) expect(isPrivateAddress(a), a).toBe(false);
  });
});

describe("framingAllowed", () => {
  it("is refused by X-Frame-Options and by a frame-ancestors list without everybody", () => {
    expect(framingAllowed({ "x-frame-options": "DENY" })).toBe(false);
    expect(framingAllowed({ "x-frame-options": "SAMEORIGIN" })).toBe(false);
    expect(framingAllowed({ "content-security-policy": "default-src 'self'; frame-ancestors 'self'" })).toBe(false);
    expect(framingAllowed({ "content-security-policy": "frame-ancestors 'none'" })).toBe(false);
  });
  it("is allowed with no rule, or a rule that lets everybody in", () => {
    expect(framingAllowed({})).toBe(true);
    expect(framingAllowed({ "content-security-policy": "default-src 'self'" })).toBe(true);
    expect(framingAllowed({ "content-security-policy": "frame-ancestors *" })).toBe(true);
    expect(framingAllowed({ "content-security-policy": ["img-src *", "frame-ancestors https:"] })).toBe(true);
  });
});

describe("tooMany", () => {
  it("refuses the 21st check of one person within a minute, not somebody else's, and forgives after a minute", () => {
    const t = 1_000_000;
    for (let i = 0; i < 20; i++) expect(tooMany("rate-user", t + i)).toBe(false);
    expect(tooMany("rate-user", t + 21)).toBe(true);
    expect(tooMany("other-user", t + 21)).toBe(false);
    expect(tooMany("rate-user", t + 61_000)).toBe(false);
  });
});

describe("linkOf", () => {
  it("is null without a link", async () => {
    expect(await linkOf("hello")).toBeNull();
  });
  it("uses the player for a video, without asking the site", async () => {
    expect(await linkOf("https://youtu.be/dQw4w9WgXcQ")).toEqual({ url: "https://youtu.be/dQw4w9WgXcQ", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
  });
  it("keeps the link but never frames an internal address", async () => {
    expect(await linkOf("http://127.0.0.1/secret")).toEqual({ url: "http://127.0.0.1/secret", embedUrl: null });
    expect(await linkOf("http://169.254.169.254/latest/meta-data")).toMatchObject({ embedUrl: null });
    expect(await linkOf("http://localhost:3000/")).toMatchObject({ embedUrl: null });
  });
});
