/**
 * 한 벌 틀 만들기 (조각 7, DESIGN 6-1·6-4절). `npx tsx scripts/build-workbook-template.ts <현황판.xlsx> <틀.xlsx>`
 *
 * 승인된 방식(2026-10-06): **사용처 기입란·입고 기입란의 과거 줄 2,314줄은 틀에 값째 그대로 두고**, 프로그램은 그 아래에 새 줄만 붙인다.
 * 그래서 틀은 현황판 사본에서 만든다 — 손으로 만든 옛 틀(빈 본보기 줄만 있던 것)이 아니라.
 *
 *  1. 부품 재고 현황: 머리글 + 본보기 줄 둘(¥ 줄 = 2행, ₩ 줄 = 공급가 서식이 ₩ 인 첫 줄)만 남기고 값을 비운다. 표 범위 A1:L3.
 *  2. 사용처 기입란·입고 기입란: **한 글자도 안 바꾼다** (시트 XML·공유 문자열 그대로). 과거 줄이 곧 자료다.
 *  3. 수량 변경 기록(새 시트): 사용처 기입란을 베껴 칸 이름을 바꾼다(엑셀에서 사람이 한 것과 같다). 머리글 + 빈 본보기 줄 하나, 표 「수량변경표」.
 *     같은 통합문서의 서식 번호를 그대로 쓰므로 서식이 어긋날 일이 없다 — 옛 틀의 4번 시트를 가져오면 서식 번호가 다른 파일 것이라 못 쓴다.
 *  4. 통합문서 목록·관계·내용 형식·인쇄 제목·문서 속성에 새 시트를 더한다.
 *
 * 🔴 현황판 사본은 읽기만 한다. 결과는 새 파일로 쓴다 — 있는 파일을 덮어쓰지 않는다(옛 틀은 전환일에 담당자에게 넘길 것, 지우지 말 것).
 * 틀 자체는 그 뒤로 프로그램이 절대 고치지 않는다(README 「미리 알아야 할 것 1」).
 */
import { existsSync, writeFileSync } from "node:fs";
import { readKrwStyleIndexes } from "../src/lib/legacy/workbook-styles";
import { retargetTable } from "../src/lib/excel/stock-workbook";
import { escapeXmlText } from "../src/lib/xlsx/sheet-patch";
import { blankRow, parseSheetRows, renumberRow, syncDimension, writeSheetRows } from "../src/lib/xlsx/sheet-rows";
import { CONTENT_TYPES_PART, resolveSheetPart, STYLES_PART, WORKBOOK_PART, WORKBOOK_RELS_PART } from "../src/lib/xlsx/workbook-parts";
import { ZipArchive } from "../src/lib/xlsx/zip-reader";
import { writeZip } from "../src/lib/xlsx/zip-writer";

const SHEET_PARTS = "부품 재고 현황";
const SHEET_USE = "사용처 기입란";
const SHEET_CHANGE = "수량 변경 기록";
/** 수량 변경 기록 시트의 칸 (DESIGN 6-2절). 사용처 기입란 A~N 의 서식을 그대로 받는다. */
const CHANGE_HEADERS = ["No.", "날짜", "종류", "품명", "품명2", "도번", "교산 품번", "현 재고", "변동", "이후 재고", "담당", "비고", "소유", "상대"] as const;

function cellStyle(rowXml: string, column: string): number {
  const m = new RegExp(`<c\\s+r="${column}\\d+"[^>]*?\\bs="(\\d+)"`).exec(rowXml);
  return m ? Number(m[1]) : 0;
}

function main(): void {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) {
    console.error("쓰는 법: npx tsx scripts/build-workbook-template.ts <현황판.xlsx> <만들 틀.xlsx>");
    process.exit(2);
  }
  if (existsSync(out)) throw new Error(`이미 있는 파일입니다: ${out} — 덮어쓰지 않습니다. 다른 이름을 주십시오.`);
  const archive = ZipArchive.fromFile(src);
  const replacements = new Map<string, Buffer>();
  const additions: { name: string; data: Buffer }[] = [];

  // ── 1. 부품 재고 현황: 머리글 + ¥ 본보기 + ₩ 본보기 ──
  const partsPart = resolveSheetPart(archive, SHEET_PARTS);
  const partsXml = archive.readText(partsPart);
  const krw = readKrwStyleIndexes(archive.readTextOrNull(STYLES_PART) ?? "");
  const rows = parseSheetRows(partsXml);
  const header = rows.find((r) => r.rowNumber === 1);
  const jpy = rows.find((r) => r.rowNumber > 1 && !krw.has(cellStyle(r.xml, "G")));
  const won = rows.find((r) => r.rowNumber > 1 && krw.has(cellStyle(r.xml, "G")));
  if (!header || !jpy || !won) throw new Error("부품 재고 현황에서 머리글·¥ 줄·₩ 줄을 찾지 못했습니다.");
  const partsRows = [header, renumberRow(blankRow(jpy), 2), renumberRow(blankRow(won), 3)];
  replacements.set(partsPart, Buffer.from(syncDimension(writeSheetRows(partsXml, partsRows), partsRows), "utf8"));
  const partsTable = tablePartOf(archive, partsPart);
  replacements.set(partsTable, Buffer.from(retargetTable(archive.readText(partsTable), 3), "utf8"));

  // ── 3. 수량 변경 기록: 사용처 기입란을 베껴 칸 이름을 바꾼다 ──
  const usePart = resolveSheetPart(archive, SHEET_USE);
  const useXml = archive.readText(usePart);
  const useRows = parseSheetRows(useXml);
  const useHeader = useRows[0];
  const useLast = useRows[useRows.length - 1];
  if (useHeader.rowNumber !== 1 || useRows.length < 2) throw new Error("사용처 기입란의 머리글·마지막 줄을 찾지 못했습니다.");
  const headerStyle = cellStyle(useHeader.xml, "A");
  const headerOpen = /^<row\b[^>]*>/.exec(useHeader.xml)![0].replace(/spans="[^"]*"/, 'spans="1:14"');
  const headerCells = CHANGE_HEADERS.map((h, i) => `<c r="${String.fromCharCode(65 + i)}1" s="${headerStyle}" t="inlineStr"><is><t>${escapeXmlText(h)}</t></is></c>`).join("");
  const changeHeader = { rowNumber: 1, xml: `${headerOpen}${headerCells}</row>` };
  // 본보기 줄: 마지막 과거 줄의 서식(A~N)만, 값 없이. O 칸(사용처)은 뺀다. 높이는 두지 않는다(엑셀이 맞춘다).
  let model = renumberRow(blankRow(useLast), 2).xml;
  model = model.replace(/<c r="O2"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/, "").replace(/spans="[^"]*"/, 'spans="1:14"').replace(/\s+ht="[^"]*"/, "").replace(/\s+customHeight="[^"]*"/, "");
  const changeRows = [changeHeader, { rowNumber: 2, xml: model }];
  let changeXml = writeSheetRows(useXml, changeRows);
  changeXml = syncDimension(changeXml.replace(/<dimension ref="A1:[A-Z]+\d+"\/>/, '<dimension ref="A1:N2"/>'), changeRows);
  changeXml = changeXml.replace(/<col min="15"[^>]*\/>/, "").replace(/tabSelected="1"\s*/, "");
  changeXml = changeXml.replace(/xr:uid="\{([0-9A-F-]+)\}"/, (_m, id: string) => `xr:uid="{${id.slice(0, -2)}04}"`);
  const changePart = "xl/worksheets/sheet4.xml";
  if (archive.readTextOrNull(changePart) !== null) throw new Error("현황판에 이미 sheet4 가 있습니다 — 시트가 셋인 사본이어야 합니다.");
  additions.push({ name: changePart, data: Buffer.from(changeXml, "utf8") });

  // 표: 사용처표 → 수량변경표. uid 는 전부 뗀다(겹치면 안 되는 값이라 새로 짓느니 없는 편이 낫다 — 선택 속성).
  const useTable = tablePartOf(archive, usePart);
  let tableXml = archive.readText(useTable);
  tableXml = tableXml.replace(/\s+xr:uid="[^"]*"/g, "").replace(/\s+xr3:uid="[^"]*"/g, "");
  tableXml = tableXml.replace(/\bid="\d+"/, 'id="4"').replace(/name="사용처표"/, 'name="수량변경표"').replace(/displayName="사용처표"/, 'displayName="수량변경표"');
  tableXml = retargetTable(tableXml.replace(/ref="A1:O\d+"/g, 'ref="A1:N2"'), 2);
  const cols = CHANGE_HEADERS.map((h, i) => `<tableColumn id="${i + 1}" name="${escapeXmlText(h)}"/>`).join("");
  tableXml = tableXml.replace(/<tableColumns count="\d+">[\s\S]*?<\/tableColumns>/, `<tableColumns count="${CHANGE_HEADERS.length}">${cols}</tableColumns>`);
  const changeTable = "xl/tables/table4.xml";
  additions.push({ name: changeTable, data: Buffer.from(tableXml, "utf8") });
  additions.push({
    name: "xl/worksheets/_rels/sheet4.xml.rels",
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table4.xml"/></Relationships>`,
      "utf8",
    ),
  });

  // ── 4. 통합문서 목록·관계·내용 형식·인쇄 제목·문서 속성 ──
  const wbXml = archive.readText(WORKBOOK_PART);
  const relsXml = archive.readText(WORKBOOK_RELS_PART);
  const usedIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const newRel = `rId${Math.max(0, ...usedIds) + 1}`;
  const sheetIds = [...wbXml.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1]));
  const newSheetId = Math.max(0, ...sheetIds) + 1;
  const sheetCount = (wbXml.match(/<sheet\b/g) ?? []).length;
  let nextWb = wbXml.replace(/<\/sheets>/, `<sheet name="${escapeXmlText(SHEET_CHANGE)}" sheetId="${newSheetId}" r:id="${newRel}"/></sheets>`);
  nextWb = nextWb.replace(/<\/definedNames>/, `<definedName name="_xlnm.Print_Titles" localSheetId="${sheetCount}">'${SHEET_CHANGE}'!$1:$1</definedName></definedNames>`);
  replacements.set(WORKBOOK_PART, Buffer.from(nextWb, "utf8"));
  replacements.set(
    WORKBOOK_RELS_PART,
    Buffer.from(relsXml.replace(/<\/Relationships>/, `<Relationship Id="${newRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/></Relationships>`), "utf8"),
  );
  const ct = archive.readText(CONTENT_TYPES_PART);
  replacements.set(
    CONTENT_TYPES_PART,
    Buffer.from(
      ct.replace(
        /<\/Types>/,
        `<Override PartName="/${changePart}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/${changeTable}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>`,
      ),
      "utf8",
    ),
  );
  const app = archive.readTextOrNull("docProps/app.xml");
  if (app !== null) {
    // 시트 4장·이름 범위 4개. 틀려도 엑셀은 열지만 맞춰 둔다.
    let nextApp = app.replace(/<vt:i4>3<\/vt:i4>/g, "<vt:i4>4</vt:i4>").replace(/<vt:vector size="6" baseType="lpstr">/, '<vt:vector size="8" baseType="lpstr">');
    nextApp = nextApp.replace(/<vt:lpstr>입고 기입란<\/vt:lpstr>/, `<vt:lpstr>입고 기입란</vt:lpstr><vt:lpstr>${SHEET_CHANGE}</vt:lpstr>`);
    nextApp = nextApp.replace(/<vt:lpstr>'입고 기입란'!Print_Titles<\/vt:lpstr>/, `<vt:lpstr>'입고 기입란'!Print_Titles</vt:lpstr><vt:lpstr>'${SHEET_CHANGE}'!Print_Titles</vt:lpstr>`);
    replacements.set("docProps/app.xml", Buffer.from(nextApp, "utf8"));
  }

  const entries: { name: string; data: Buffer }[] = [];
  for (const e of archive.listEntries()) entries.push({ name: e.name, data: replacements.get(e.name) ?? archive.readEntry(e.name) ?? Buffer.alloc(0) });
  entries.push(...additions);
  writeFileSync(out, writeZip(entries));
  console.log(`틀을 만들었습니다: ${out}`);
  console.log(`  부품 재고 현황: 머리글 + 본보기 2줄 (¥ ${jpy.rowNumber}행, ₩ ${won.rowNumber}행에서) · 사용처 기입란 ${useRows.length - 1}줄·입고 기입란 그대로 · 수량 변경 기록 새로`);
}

function tablePartOf(archive: ZipArchive, sheetPart: string): string {
  const slash = sheetPart.lastIndexOf("/");
  const rels = archive.readText(`${sheetPart.slice(0, slash + 1)}_rels/${sheetPart.slice(slash + 1)}.rels`);
  const m = /Target="\.\.\/(tables\/[^"]+)"/.exec(rels);
  if (!m) throw new Error(`${sheetPart} 에 표 관계가 없습니다.`);
  return `xl/${m[1]}`;
}

try {
  main();
} catch (e) {
  console.error("틀 만들기 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
}

