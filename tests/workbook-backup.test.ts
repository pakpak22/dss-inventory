import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backupFileName, backupStem, backupsToDelete, monthlyBackupFileName, parseBackupDate, parseMonthlyBackupDate, summarizeBackups, summarizeMonthlyBackups } from "../src/lib/excel/workbook-backup";

const STEM = "재고 및 견적 현황판";

describe("조각 8 일일 백업 규칙 (workbook-backup.ts)", () => {
  it("줄기·파일 이름", () => {
    assert.equal(backupStem("재고 및 견적 현황판.xlsx"), STEM);
    assert.equal(backupFileName(STEM, "2026-10-08"), "재고 및 견적 현황판_2026-10-08.xlsx");
  });

  it("백업 파일만 날짜로 알아본다 (다른 파일·다른 줄기는 null)", () => {
    assert.equal(parseBackupDate("재고 및 견적 현황판_2026-10-08.xlsx", STEM), "2026-10-08");
    assert.equal(parseBackupDate("재고 및 견적 현황판.xlsx", STEM), null); // 백업 아님
    assert.equal(parseBackupDate("현황판_사람수정_20261008-1012.xlsx", STEM), null); // 치워 둔 파일
    assert.equal(parseBackupDate("다른이름_2026-10-08.xlsx", STEM), null); // 줄기 다름
    assert.equal(parseBackupDate("재고 및 견적 현황판_2026-13-40.xlsx", STEM), "2026-13-40"); // 모양만 본다(실제 유효성은 날짜 생성 쪽이 보장)
  });

  it("30일 넘은 것만 지운다 — 최신 30 날짜 보관", () => {
    const names: string[] = [];
    for (let d = 1; d <= 40; d++) names.push(backupFileName(STEM, `2026-03-${String(d).padStart(2, "0")}`));
    const del = backupsToDelete(names, STEM, 30);
    assert.equal(del.length, 10);
    // 가장 오래된 10개(03-01 ~ 03-10)가 지워지고 03-11 ~ 03-40 이 남는다
    assert.ok(del.includes("재고 및 견적 현황판_2026-03-01.xlsx"));
    assert.ok(del.includes("재고 및 견적 현황판_2026-03-10.xlsx"));
    assert.ok(!del.includes("재고 및 견적 현황판_2026-03-11.xlsx"));
  });

  it("보관 개수 이하면 아무것도 안 지운다. 섞인 폴더에서 백업만 센다", () => {
    const names = ["재고 및 견적 현황판_2026-10-06.xlsx", "재고 및 견적 현황판_2026-10-08.xlsx", "현황판_사람수정_20261008-1012.xlsx", "메모.txt"];
    assert.deepEqual(backupsToDelete(names, STEM, 30), []);
    assert.deepEqual(summarizeBackups(names, STEM), { count: 2, latest: "2026-10-08" });
  });

  it("월별 영구 백업: 이름·달 파싱. 일일(_YYYY-MM-DD)과 안 겹친다", () => {
    assert.equal(monthlyBackupFileName(STEM, "2026-10"), "재고 및 견적 현황판_2026-10.xlsx");
    assert.equal(parseMonthlyBackupDate("재고 및 견적 현황판_2026-10.xlsx", STEM), "2026-10");
    assert.equal(parseMonthlyBackupDate("재고 및 견적 현황판_2026-10-08.xlsx", STEM), null); // 일일은 월별 아님
    assert.equal(parseBackupDate("재고 및 견적 현황판_2026-10.xlsx", STEM), null); // 월별은 일일 아님
    assert.deepEqual(summarizeMonthlyBackups(["재고 및 견적 현황판_2026-09.xlsx", "재고 및 견적 현황판_2026-10.xlsx", "메모.txt"], STEM), { count: 2, latest: "2026-10" });
  });
});
