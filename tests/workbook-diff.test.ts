import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffWorkbooks, normalizeText } from "../src/lib/excel/workbook-diff";
import { writeZip } from "../src/lib/xlsx/zip-writer";

/**
 * 조각 8-A 비교 함수 검사. 실제 틀 없이 돌도록, 네 시트를 가진 작은 통합문서를 손으로 만든다(표·서식은 비교에 안 쓰여 뺀다).
 * 셀 값은 글자(inlineStr) 아니면 숫자(<v>). 날짜 칸(B)도 글자로 넣어 일련번호 변환을 피한다 — 변환은 excel-date 쪽 테스트가 본다.
 */
type Cell = string | number | null;
const NAMES = ["부품 재고 현황", "사용처 기입란", "입고 기입란", "수량 변경 기록"];

function colLetter(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function rowXml(r: number, cells: Cell[]): string {
  const cs = cells
    .map((v, i) => {
      const ref = `${colLetter(i)}${r}`;
      if (v === null || v === "") return "";
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    })
    .join("");
  return `<row r="${r}">${cs}</row>`;
}
function sheetXml(rows: Cell[][]): string {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const body = rows.map((cells, i) => rowXml(i + 1, cells)).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${ns}><sheetData>${body}</sheetData></worksheet>`;
}
/** sheets: 시트 이름 → 줄들(0번째 줄 = 머리글). 네 시트 모두 있어야 한다. */
function wb(sheets: Record<string, Cell[][]>): Buffer {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
  const xml = (s: string) => Buffer.from(s.startsWith("<?xml") ? s : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`, "utf8");
  const sheetTags = NAMES.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  const relTags = NAMES.map((_n, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  const entries = [
    { name: "[Content_Types].xml", data: xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`) },
    { name: "xl/workbook.xml", data: xml(`<workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets>${sheetTags}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: xml(`<Relationships ${rel}>${relTags}</Relationships>`) },
  ];
  NAMES.forEach((name, i) => entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml(sheetXml(sheets[name])) }));
  return writeZip(entries);
}

// 머리글 + 데이터 한 줄짜리 기본 네 시트 (칸 수: 12 / 15 / 11 / 14)
const H_PARTS = ["No.", "품명", "품명2", "교산 품번", "도번", "수량", "공급가", "견적가", "비고", "항목", "분류", "소유"];
const H_USE = ["No.", "날짜", "인수번호", "품명", "품명2", "도번", "교산 품번", "현 재고", "사용 재고", "이후 재고", "목적", "비고", "소유", "유상무상", "사용처"];
const H_RECEIVE = ["No.", "날짜", "품명", "품명2", "도번", "교산 품번", "현 재고", "입고", "이후 재고", "비고", "소유"];
const H_CHANGE = ["No.", "날짜", "종류", "품명", "품명2", "도번", "교산 품번", "현 재고", "변동", "이후 재고", "담당", "비고", "소유", "상대"];

function base(): Record<string, Cell[][]> {
  return {
    "부품 재고 현황": [H_PARTS, [1, "볼트", "-", "-", "-", 5, null, null, "", "소모품", "구매품", "DSS"], [3, "너트", "-", "-", "-", 2, null, null, "", "소모품", "구매품", "DSS"]],
    "사용처 기입란": [H_USE, [1, "2026-10-01", "D260701", "볼트", "-", "-", "-", 5, 1, 4, "수리/정영빈", "", "DSS", "유상", "현장"]],
    "입고 기입란": [H_RECEIVE, [1, "2026-10-01", "볼트", "-", "-", "-", 4, 10, 14, "", "DSS"]],
    "수량 변경 기록": [H_CHANGE, [1, "2026-10-01", "조정", "볼트", "-", "-", "-", 14, -1, 13, "정영빈", "", "DSS", "-"]],
  };
}

describe("조각 8-A 치워 둔 파일 비교 (workbook-diff.ts)", () => {
  it("값 차이 없음: 같은 파일이면 totalChanges 0", () => {
    const d = diffWorkbooks(wb(base()), wb(base()));
    assert.equal(d.totalChanges, 0);
    assert.equal(d.sheets.length, 4);
    assert.deepEqual(d.sheets[0].columns, H_PARTS);
  });

  it("부품 재고 현황: 수량 바뀜·새 No.·사라진 No. 를 No. 로 맞춰 가린다", () => {
    // 치워 둔 파일: No.1 수량 5→8, No.2 새로 더함, No.3(너트) 지움
    const e = base();
    e["부품 재고 현황"] = [H_PARTS, [1, "볼트", "-", "-", "-", 8, null, null, "", "소모품", "구매품", "DSS"], [2, "와셔", "-", "-", "-", 7, null, null, "", "소모품", "구매품", "DSS"]];
    const d = diffWorkbooks(wb(base()), wb(e));
    const parts = d.sheets.find((s) => s.sheet === "부품 재고 현황")!;
    assert.equal(parts.changed.length, 1);
    assert.equal(parts.changed[0].key, "1");
    assert.deepEqual(parts.changed[0].cells.map((c) => [c.label, c.before, c.after]), [["수량", "5", "8"]]);
    assert.deepEqual(parts.added.map((r) => r.key), ["2"]);
    assert.deepEqual(parts.removed.map((r) => r.key), ["3"]);
  });

  it("사용처 기입란: 끝에 붙인 줄 = 더한 줄", () => {
    const e = base();
    e["사용처 기입란"].push([2, "2026-10-08", "-", "너트", "-", "-", "-", 2, 1, 1, "기타/정영빈", "손으로 적음", "DSS", "무상", "창고"]);
    const d = diffWorkbooks(wb(base()), wb(e));
    const use = d.sheets.find((s) => s.sheet === "사용처 기입란")!;
    assert.equal(use.added.length, 1);
    assert.equal(use.added[0].key, "3"); // 머리글 1행 + 기존 1줄(2행) + 더한 줄(3행)
    assert.equal(use.added[0].label, "3행");
    assert.equal(use.added[0].values[3], "너트");
    assert.equal(use.changed.length, 0);
  });

  it("한 줄의 여러 칸이 바뀌면 그 칸만 모아 준다", () => {
    const e = base();
    e["수량 변경 기록"][1][8] = -2; // 변동 -1 → -2
    e["수량 변경 기록"][1][11] = "오타 고침"; // 비고 "" → 글자
    const d = diffWorkbooks(wb(base()), wb(e));
    const chg = d.sheets.find((s) => s.sheet === "수량 변경 기록")!;
    assert.equal(chg.changed.length, 1);
    assert.deepEqual(
      chg.changed[0].cells.map((c) => c.label).sort(),
      ["변동", "비고"],
    );
  });
  it("줄바꿈 꼴만 다른 비고는 차이가 아니다 (CRLF vs LF, _x000D_)", () => {
    // 2026-10-12 실측: 프로그램이 쓴 비고는 CRLF, 엑셀이 저장하면 LF 가 되어 손대지 않은 여러 줄 비고가 전부 「바뀜」으로 잡혔다.
    assert.equal(normalizeText("가" + String.fromCharCode(13, 10) + "나"), "가" + String.fromCharCode(10) + "나");
    assert.equal(normalizeText("가_x000D_" + String.fromCharCode(10) + "나"), "가" + String.fromCharCode(10) + "나");
    assert.equal(normalizeText("  가" + String.fromCharCode(13) + "나  "), "가" + String.fromCharCode(10) + "나");
    const b = base();
    b["부품 재고 현황"][1][8] = "첫 줄_x000D_" + String.fromCharCode(10) + "둘째 줄";
    const e = base();
    e["부품 재고 현황"][1][8] = "첫 줄" + String.fromCharCode(10) + "둘째 줄";
    const d = diffWorkbooks(wb(b), wb(e));
    assert.equal(d.totalChanges, 0);
  });
});
