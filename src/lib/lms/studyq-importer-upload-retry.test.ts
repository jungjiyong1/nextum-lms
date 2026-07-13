import { describe, expect, it, vi } from "vitest";

// The canonical importer is an executable ESM module whose retry helpers are
// deliberately exported so production upload behavior can be regression-tested.
// @ts-expect-error JavaScript script modules do not have generated declarations.
import { isTransientStorageError, uploadStudyqAssetWithRetry } from "../../../scripts/import-studyq-bank.mjs";

describe("StudyQ asset upload retry", () => {
  it("retries a transient gateway timeout and then succeeds", async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { statusCode: 504, message: "Gateway Timeout" } })
      .mockResolvedValueOnce({ data: { path: "asset.png" }, error: null });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await uploadStudyqAssetWithRetry(
      { upload },
      "asset.png",
      Buffer.from("image"),
      { contentType: "image/png", upsert: true },
      { maxAttempts: 5, baseDelayMs: 10, sleep },
    );

    expect(result.error).toBeNull();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("does not retry a permanent client error", async () => {
    const error = { statusCode: 400, message: "Invalid object path" };
    const upload = vi.fn().mockResolvedValue({ data: null, error });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await uploadStudyqAssetWithRetry(
      { upload },
      "asset.png",
      Buffer.from("image"),
      { contentType: "image/png", upsert: true },
      { maxAttempts: 5, baseDelayMs: 10, sleep },
    );

    expect(result.error).toBe(error);
    expect(upload).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("classifies thrown network failures as transient", () => {
    expect(isTransientStorageError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientStorageError({ status: 429, message: "rate limited" })).toBe(true);
    expect(isTransientStorageError({ status: 400, message: "Bad Request" })).toBe(true);
    expect(isTransientStorageError({ status: 400, message: "Invalid object path" })).toBe(false);
    expect(isTransientStorageError({ status: 403, message: "forbidden" })).toBe(false);
  });
});
