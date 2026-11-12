import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, SAFEBOX_MAX_BYTES } from "../src/constants";
import { DEFAULT_LIMITS, limitsOfData } from "../src/limits";

const MB = 1024 * 1024;

/** The limits of an account: what is not written has the default, and a file is never above what one request can carry. */
describe("account limits", () => {
  it("nothing written: the defaults", () => {
    expect(limitsOfData(undefined)).toEqual(DEFAULT_LIMITS);
    expect(limitsOfData({})).toEqual({ safeboxFileBytes: MAX_UPLOAD_BYTES, safeboxTotalBytes: SAFEBOX_MAX_BYTES });
  });

  it("a total written on the account counts", () => {
    expect(limitsOfData({ limits: { safeboxTotalBytes: 1000 * MB } }).safeboxTotalBytes).toBe(1000 * MB);
  });

  it("a smaller file limit counts", () => {
    expect(limitsOfData({ limits: { safeboxFileBytes: 5 * MB } }).safeboxFileBytes).toBe(5 * MB);
  });

  it("a file limit above one request is held at what one request can carry", () => {
    expect(limitsOfData({ limits: { safeboxFileBytes: 200 * MB } }).safeboxFileBytes).toBe(MAX_UPLOAD_BYTES);
  });

  it("damaged values fall back to the defaults", () => {
    expect(limitsOfData({ limits: { safeboxFileBytes: -1, safeboxTotalBytes: "big" } })).toEqual(DEFAULT_LIMITS);
    expect(limitsOfData({ limits: { safeboxFileBytes: NaN, safeboxTotalBytes: 0 } })).toEqual(DEFAULT_LIMITS);
  });
});
