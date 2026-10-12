/**
 * 엑셀 한 벌의 **일일 백업** 이름·날짜 규칙 (조각 8, 2026-10-08 사용자 요청. REQUIREMENTS 6절 「하루 한 벌, 30일 치」).
 *
 * 🔴 순수 함수만. 파일·시각을 모른다 — 실제 파일시스템에 닿는 일은 workbook-sync.ts 가 한다.
 * 백업 파일 이름: `<한 벌 파일 이름(확장자 뗀 것)>_YYYY-MM-DD.xlsx`. 하루에 한 벌(그날 것은 최신 상태로 덮어쓴다).
 *
 * NAS 야간 백업(담당자)과 별개의 보완책이다 — 데이터 폴더 안에 두어 그 백업에도 함께 들어가고, 백업이 걸리기 전에도 되돌릴 지점이 생긴다.
 */
export const BACKUP_KEEP_DAYS = 30;

/** 파일 이름에서 확장자(.xlsx 등)를 뗀 줄기. `재고 및 견적 현황판.xlsx` → `재고 및 견적 현황판` */
export function backupStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function backupFileName(stem: string, dateIso: string): string {
  return `${stem}_${dateIso}.xlsx`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 백업 파일 이름이면 그 날짜(YYYY-MM-DD), 아니면 null. 줄기가 정확히 같아야 한다(다른 파일을 지우지 않도록). */
export function parseBackupDate(name: string, stem: string): string | null {
  const m = new RegExp(`^${escapeRegExp(stem)}_(\\d{4}-\\d{2}-\\d{2})\\.xlsx$`).exec(name);
  return m ? m[1] : null;
}

/**
 * 보관 기간을 넘긴 백업 파일 이름들. 날짜 내림차순으로 최신 `keepDays` 날짜만 남기고 나머지를 지운다.
 * 🔴 줄기가 맞는 백업 파일만 본다 — 폴더의 다른 파일은 손대지 않는다.
 */
export function backupsToDelete(names: readonly string[], stem: string, keepDays: number = BACKUP_KEEP_DAYS): string[] {
  const dated = names
    .map((name) => ({ name, date: parseBackupDate(name, stem) }))
    .filter((x): x is { name: string; date: string } => x.date !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  return dated.slice(Math.max(0, keepDays)).map((x) => x.name);
}

/** 보관 중인 백업의 요약(날짜만. 파일 읽기는 부르는 쪽에서). */
export function summarizeBackups(names: readonly string[], stem: string): { count: number; latest: string | null } {
  const dates = names.map((n) => parseBackupDate(n, stem)).filter((d): d is string => d !== null);
  dates.sort((a, b) => b.localeCompare(a));
  return { count: dates.length, latest: dates[0] ?? null };
}

/**
 * 월별 영구 백업 (2026-10-08 사용자 요청). 원본 한 벌이 있는 폴더의 `OLD/` 에 달마다 한 벌(`<줄기>_YYYY-MM.xlsx`).
 * 🔴 **지우지 않는다** — 사무실에 영구 보관하는 것이라 일일 백업과 달리 보관 기간 정리가 없다. 그달 것은 최신 상태로 덮어써 월말 상태로 굳는다.
 * 이름이 일일(`_YYYY-MM-DD`)과 겹치지 않는다(자리 수가 달라 서로의 정규식에 안 걸린다). 폴더도 다르다(backup/ vs workbook/OLD/).
 */
export function monthlyBackupFileName(stem: string, month: string): string {
  return `${stem}_${month}.xlsx`;
}

/** 월별 백업 파일이면 그 달(YYYY-MM), 아니면 null. */
export function parseMonthlyBackupDate(name: string, stem: string): string | null {
  const m = new RegExp(`^${escapeRegExp(stem)}_(\\d{4}-\\d{2})\\.xlsx$`).exec(name);
  return m ? m[1] : null;
}

export function summarizeMonthlyBackups(names: readonly string[], stem: string): { count: number; latest: string | null } {
  const months = names.map((n) => parseMonthlyBackupDate(n, stem)).filter((d): d is string => d !== null);
  months.sort((a, b) => b.localeCompare(a));
  return { count: months.length, latest: months[0] ?? null };
}
