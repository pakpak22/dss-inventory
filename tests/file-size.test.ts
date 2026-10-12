import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFileSize } from "../src/lib/file-size";

describe("formatFileSize — 파일 크기를 KB/MB 로", () => {
  it("1 KB 미만은 B", () => assert.equal(formatFileSize(512), "512 B"));
  it("1 MB 미만은 KB 소수 한 자리", () => assert.equal(formatFileSize(195609), "191.0 KB"));
  it("1 MB 이상은 MB", () => assert.equal(formatFileSize(1_900_000), "1.8 MB"));
  it("경계: 1024 B = 1.0 KB", () => assert.equal(formatFileSize(1024), "1.0 KB"));
  it("음수·NaN 은 -", () => {
    assert.equal(formatFileSize(-1), "-");
    assert.equal(formatFileSize(Number.NaN), "-");
  });
});
