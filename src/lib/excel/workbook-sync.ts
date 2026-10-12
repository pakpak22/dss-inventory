import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit-logs";
import { workbookStates, type WorkbookState } from "@/db/schema/workbook-states";
import { auditValues } from "@/lib/audit";
import { env } from "@/lib/env";
import { buildFullWorkbook } from "./full-workbook";
import { loadWorkbookData } from "./workbook-data";
import { BACKUP_KEEP_DAYS, backupFileName, backupStem, backupsToDelete, monthlyBackupFileName, summarizeBackups, summarizeMonthlyBackups } from "./workbook-backup";
import { diffWorkbooks, type WorkbookDiff } from "./workbook-diff";

/**
 * 엑셀 한 벌 자동 갱신 (조각 7, DESIGN 6-5절, REQUIREMENTS 6절 「덮어쓰기 사고를 막는 장치」).
 *
 *  1. 수량·부품이 바뀌면 `markWorkbookDirty()` 가 「써야 함」 시각을 남긴다(한 트랜잭션 안에서 본 작업과 같이).
 *  2. `runWorkbookSync()` 가 1분마다 돈다(instrumentation.ts). 표시된 지 SYNC_DELAY_MS 가 지났으면 쓴다 — 바뀔 때마다 바로 쓰지 않고 모은다.
 *  3. 쓰기 전에 지금 파일의 크기·지문을 마지막으로 **우리가** 쓴 것과 맞춰 본다.
 *     - 같으면(또는 파일이 없으면): 임시 파일에 다 쓰고 이름을 바꾼다 → 새 크기·지문을 남긴다.
 *     - 다르면: 사람이 손댄 것. **덮어쓰지 않고** `현황판_사람수정_YYYYMMDD-HHMM.xlsx` 로 치워 두고 PARKED 로 멈춘다. 관리자가 내용을 프로그램에 옮긴 뒤
 *       [다시 쓰기 시작]을 눌러야 다시 쓴다. 지우지 않는다.
 *  4. 누가 엑셀을 열어 두어 이름을 못 바꾸면 ERROR 로 남기고 다음 차례에 다시 한다. 연속 실패 횟수를 센다.
 *
 * 🔴 실제 파일시스템에 닿는 곳은 이 파일뿐이다. 경로는 환경변수에서만 오고(CLAUDE.md 12-1절), DB 에는 치워 둔 파일 **이름**만 남긴다.
 * 🔴 `server-only` 를 붙이지 않는다 — instrumentation(React 환경 아님)에서도 부른다. 화면·액션 쪽은 자기 자리에서 세션을 검사한다.
 */
export const SYNC_DELAY_MS = 60_000;
/** 한 줄뿐인 표의 고정 id. 둘이 동시에 처음 넣어도 한 줄만 남게 (ON CONFLICT). */
const STATE_ID = "00000000-0000-4000-8000-000000000001";
/** 조언 잠금 열쇠. 쓰기와 [엑셀 기준 적용](8-B)이 같은 열쇠를 써서 서로 겹치지 않는다. */
export const LOCK_KEY = "dss-inventory:workbook-sync";
const SCRIPT_ACTOR = "엑셀 자동 갱신";

export type SyncResult =
  | { outcome: "written"; size: number; sha256: string; rows: { parts: number; use: number; receive: number; change: number } }
  | { outcome: "skipped"; reason: "clean" | "waiting" | "parked" | "busy" }
  | { outcome: "parked"; parkedFile: string }
  | { outcome: "error"; message: string };

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Db = ReturnType<typeof db> | Tx;

/** 화면용: 「써야 함」이 있으면 몇 초 뒤에 쓰는지(0 이면 다음 차례). 없으면 null. */
export function secondsUntilNextWrite(state: WorkbookState | null, nowMs = Date.now()): number | null {
  if (!state?.dirtyAt) return null;
  return Math.max(0, Math.ceil((SYNC_DELAY_MS - (nowMs - state.dirtyAt.getTime())) / 1000));
}

export async function getWorkbookState(): Promise<WorkbookState | null> {
  const [row] = await db().select().from(workbookStates).where(eq(workbookStates.id, STATE_ID)).limit(1);
  return row ?? null;
}

/** 「써야 함」 표시. 이미 표시돼 있으면 처음 시각을 지킨다(가장 오래 기다린 변경 기준으로 1분을 센다). */
export async function markWorkbookDirty(conn: Db = db(), now = new Date()): Promise<void> {
  await conn
    .insert(workbookStates)
    .values({ id: STATE_ID, dirtyAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: workbookStates.id, set: { dirtyAt: sql`coalesce(${workbookStates.dirtyAt}, ${now.toISOString()}::timestamptz)`, updatedAt: now } });
}

/** [다시 쓰기 시작] (관리자). 멈춤을 풀고 바로 다음 차례에 쓰게 「써야 함」을 남긴다. 치워 둔 파일 이름은 기록으로 남긴다. */
export async function resumeWorkbook(actor: { id: string; name: string }, now = new Date()): Promise<void> {
  await db().transaction(async (tx) => {
    await markWorkbookDirty(tx, now);
    await tx
      .update(workbookStates)
      .set({ status: "OK", errorCount: 0, errorMessage: null, resumedBy: actor.id, resumedByName: actor.name, resumedAt: now, updatedAt: now })
      .where(eq(workbookStates.id, STATE_ID));
    await tx.insert(auditLogs).values(auditValues({ action: "WORKBOOK_RESUMED", actorId: actor.id, actorName: actor.name, target: "workbook" }));
  });
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function stampSeoul(now: Date): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

/**
 * 비교용 그림자 사본 경로 (조각 8-A). 프로그램이 쓸 때마다 같은 바이트를 여기에도 둔다 — 치워 둔 파일과 견줄 「프로그램 기준본」.
 * 공유 폴더(사람이 보는 한 벌) 밖, 데이터 폴더 안 `baseline/` 에 둔다(백업에 같이 들어간다). 실제 파일에 닿는 곳이라 path.join 을 쓴다(CLAUDE.md 12-1절).
 */
function baselinePath(): string {
  return path.join(env.inventoryDataDir, "baseline", path.basename(env.stockWorkbookPath));
}

/** 그림자 사본 쓰기. 🔴 실패해도 본 쓰기는 성공으로 둔다 — 그림자는 비교 편의일 뿐, 없으면 「내려받아 직접 비교」로 넘어간다. */
async function writeBaseline(bytes: Buffer): Promise<void> {
  try {
    const p = baselinePath();
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, bytes);
  } catch (e) {
    console.warn("[workbook] 그림자 사본 쓰기 실패(무시):", e instanceof Error ? e.message : e);
  }
}

/** 서울 날짜 YYYY-MM-DD (일일 백업 이름용). 서버(NAS)가 UTC 라 timeZone 을 반드시 명시한다 (CLAUDE.md 10절). */
function dateStampSeoul(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 서울 달 YYYY-MM (월별 백업 이름용). formatToParts 로 자리 수를 못 박는다. */
function monthStampSeoul(now: Date): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}`;
}

function backupDir(): string {
  return path.join(env.inventoryDataDir, "backup");
}

/** 월별 영구 백업 폴더: 원본 한 벌이 있는 폴더의 `OLD/`. 사무실 공유 폴더에서 보이는 자리다(2026-10-08 사용자 요청). */
function oldBackupDir(): string {
  return path.join(path.dirname(env.stockWorkbookPath), "OLD");
}

/**
 * 일일 백업 (조각 8, 2026-10-08 사용자 요청). 한 벌을 쓸 때마다 그날 백업을 최신 상태로 덮어쓰고, 보관 기간을 넘긴 것을 지운다.
 * 🔴 best-effort — 실패해도 본 쓰기는 성공으로 둔다. 데이터 폴더 안에 두어 NAS 야간 백업에도 함께 들어간다(대체가 아니라 보완).
 */
async function rotateDailyBackup(bytes: Buffer, now: Date): Promise<void> {
  try {
    const dir = backupDir();
    await mkdir(dir, { recursive: true });
    const stem = backupStem(path.basename(env.stockWorkbookPath));
    await writeFile(path.join(dir, backupFileName(stem, dateStampSeoul(now))), bytes);
    const names = await readdir(dir);
    for (const name of backupsToDelete(names, stem, BACKUP_KEEP_DAYS)) await rm(path.join(dir, name)).catch(() => {});
  } catch (e) {
    console.warn("[workbook] 일일 백업 실패(무시):", e instanceof Error ? e.message : e);
  }
}

/**
 * 월별 영구 백업 (2026-10-08 사용자 요청). 그달 파일을 최신 상태로 덮어쓴다 — 달이 바뀌면 지난달 것은 더 안 건드려 월말 상태로 굳는다.
 * 🔴 지우지 않는다(영구 보관). best-effort — 실패해도 본 쓰기는 성공으로 둔다.
 */
async function writeMonthlyBackup(bytes: Buffer, now: Date): Promise<void> {
  try {
    const dir = oldBackupDir();
    await mkdir(dir, { recursive: true });
    const stem = backupStem(path.basename(env.stockWorkbookPath));
    await writeFile(path.join(dir, monthlyBackupFileName(stem, monthStampSeoul(now))), bytes);
  } catch (e) {
    console.warn("[workbook] 월별 백업 실패(무시):", e instanceof Error ? e.message : e);
  }
}

/** 보관 중인 백업 요약 (관리자 화면용). 일일(데이터 폴더, 30일) + 월별(OLD, 영구). 못 읽으면 0. */
export async function listBackups(): Promise<{ daily: { count: number; latest: string | null; keepDays: number }; monthly: { count: number; latest: string | null } }> {
  const stem = backupStem(path.basename(env.stockWorkbookPath));
  const daily = await readdir(backupDir())
    .then((names) => summarizeBackups(names, stem))
    .catch(() => ({ count: 0, latest: null }));
  const monthly = await readdir(oldBackupDir())
    .then((names) => summarizeMonthlyBackups(names, stem))
    .catch(() => ({ count: 0, latest: null }));
  return { daily: { ...daily, keepDays: BACKUP_KEEP_DAYS }, monthly };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 지금 파일이 우리가 마지막으로 쓴 것과 같은가. 파일이 없으면 「같다」(처음 쓰기). 기록이 없는데 파일이 있으면 「다르다」(누구 것인지 모른다). */
async function fileMatchesRecord(filePath: string, state: WorkbookState | null): Promise<{ same: boolean; size: number | null }> {
  if (!(await exists(filePath))) return { same: true, size: null };
  const bytes = await readFile(filePath);
  if (!state?.writtenSha256) return { same: false, size: bytes.length };
  return { same: state.writtenSize === bytes.length && state.writtenSha256 === sha256(bytes), size: bytes.length };
}

/**
 * 한 번 돈다. `force` 면 1분을 기다리지 않고 바로 쓴다([지금 쓰기]). 멈춤(PARKED)은 force 로도 풀리지 않는다 — [다시 쓰기 시작]이 따로 있다.
 * 같은 순간 둘이 돌지 않게 DB 조언 잠금을 쓴다(서버가 둘이어도 안전).
 */
export async function runWorkbookSync(opts: { force?: boolean; now?: Date } = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  return db().transaction(async (tx): Promise<SyncResult> => {
    const [lock] = (await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) as ok`)) as unknown as Array<{ ok: boolean }>;
    if (!lock?.ok) return { outcome: "skipped", reason: "busy" };
    const [state] = await tx.select().from(workbookStates).where(eq(workbookStates.id, STATE_ID)).limit(1);
    if (state?.status === "PARKED") return { outcome: "skipped", reason: "parked" };
    if (!opts.force) {
      if (!state?.dirtyAt) return { outcome: "skipped", reason: "clean" };
      if (now.getTime() - state.dirtyAt.getTime() < SYNC_DELAY_MS) return { outcome: "skipped", reason: "waiting" };
    }
    const dirtyAt = state?.dirtyAt ?? null;
    const filePath = env.stockWorkbookPath;
    const dataDir = env.inventoryDataDir;

    // 3. 사람이 손댔나
    const check = await fileMatchesRecord(filePath, state ?? null);
    if (!check.same) {
      const base = `현황판_사람수정_${stampSeoul(now)}`;
      let parkedName = `${base}.xlsx`;
      for (let i = 1; await exists(path.join(dataDir, parkedName)); i++) parkedName = `${base}-${i}.xlsx`;
      await mkdir(dataDir, { recursive: true });
      await rename(filePath, path.join(dataDir, parkedName));
      await tx
        .insert(workbookStates)
        .values({ id: STATE_ID, status: "PARKED", parkedFile: parkedName, parkedAt: now, dirtyAt: dirtyAt ?? now, updatedAt: now })
        .onConflictDoUpdate({ target: workbookStates.id, set: { status: "PARKED", parkedFile: parkedName, parkedAt: now, updatedAt: now } });
      await tx.insert(auditLogs).values(auditValues({ action: "WORKBOOK_PARKED", actorName: SCRIPT_ACTOR, target: "workbook", detail: { parkedFile: parkedName, size: check.size } }));
      console.warn(`[workbook] 사람이 손댄 파일을 치워 두고 멈춤: ${parkedName}`);
      return { outcome: "parked", parkedFile: parkedName };
    }

    // 쓰기. 🔴 세이브포인트(중첩 트랜잭션) 안에서 — 기록 갱신 SQL 이 실패하면 그 부분만 되돌리고, 바깥 트랜잭션은 살아 있어 아래 catch 가 ERROR 를 적을 수 있다
    //    (같은 트랜잭션에서 문장이 하나 실패하면 그 뒤 문장은 전부 거부된다 — 10-07 실측).
    try {
      return await tx.transaction(async (sp): Promise<SyncResult> => {
        const [template, data] = await Promise.all([readFile(env.stockWorkbookTemplatePath), loadWorkbookData()]);
        const bytes = buildFullWorkbook(template, data);
        await mkdir(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.tmp-${process.pid}`;
        await writeFile(tmp, bytes);
        await rename(tmp, filePath);
        await writeBaseline(bytes); // 조각 8-A: 비교 기준본
        await rotateDailyBackup(bytes, now); // 조각 8: 일일 백업(하루 한 벌, 30일)
        await writeMonthlyBackup(bytes, now); // 조각 8: 월별 영구 백업(OLD 폴더, 안 지움)
        const digest = sha256(bytes);
        await sp
          .insert(workbookStates)
          .values({ id: STATE_ID, status: "OK", writtenAt: now, writtenSize: bytes.length, writtenSha256: digest, dirtyAt: null, errorCount: 0, errorMessage: null, updatedAt: now })
          .onConflictDoUpdate({
            target: workbookStates.id,
            set: {
              status: "OK",
              writtenAt: now,
              writtenSize: bytes.length,
              writtenSha256: digest,
              // 이번 차례가 시작된 시각(now)까지의 변경은 이 파일에 들어 있다 → 표시를 지운다. 그 뒤에 들어온 변경(dirty_at > now)은 남겨 다음 차례에 또 쓴다.
              // 🔴 `= 읽어 둔 dirty_at` 으로 견주면 안 된다 — JS Date 는 밀리초, DB 는 마이크로초라 같은 값이 같지 않다(10-07 실측: 표시가 안 지워짐).
              dirtyAt: sql`case when ${workbookStates.dirtyAt} <= ${now.toISOString()}::timestamptz then null else ${workbookStates.dirtyAt} end`,
              errorCount: 0,
              errorMessage: null,
              updatedAt: now,
            },
          });
        return { outcome: "written", size: bytes.length, sha256: digest, rows: { parts: data.parts.length, use: data.useRows.length, receive: data.receiveRows.length, change: data.changeRows.length } };
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await tx
        .insert(workbookStates)
        .values({ id: STATE_ID, status: "ERROR", errorMessage: message, errorCount: 1, dirtyAt: dirtyAt ?? now, updatedAt: now })
        .onConflictDoUpdate({ target: workbookStates.id, set: { status: "ERROR", errorMessage: message, errorCount: sql`${workbookStates.errorCount} + 1`, updatedAt: now } });
      console.error("[workbook] 쓰기 실패:", message);
      return { outcome: "error", message };
    }
  });
}

/** [지금 쓰기] (관리자): 표시를 남기고 기다리지 않고 바로 쓴다. */
export async function writeWorkbookNow(): Promise<SyncResult> {
  await markWorkbookDirty();
  return runWorkbookSync({ force: true });
}

export type ParkedDiffResult =
  | { available: true; diff: WorkbookDiff; parkedFile: string }
  | { available: false; reason: "not_parked" | "no_baseline" | "error"; parkedFile: string | null; message?: string };

/**
 * 치워 둔 파일(사람이 손댄 것)을 프로그램 기준본(그림자 사본)과 견준다 — 조각 8-A, 관리자 화면용. 읽기만 한다.
 * 멈춤(PARKED)이 아니면 볼 것이 없다. 그림자 사본이 없으면(이 기능 붙기 전에 멈춘 경우) 「내려받아 직접 비교」로 안내한다.
 */
export async function readParkedDiff(): Promise<ParkedDiffResult> {
  const state = await getWorkbookState();
  if (!state || state.status !== "PARKED" || !state.parkedFile) return { available: false, reason: "not_parked", parkedFile: state?.parkedFile ?? null };
  const parkedPath = path.join(env.inventoryDataDir, state.parkedFile);
  try {
    const parked = await readFile(parkedPath);
    const baseline = await readFile(baselinePath()).catch(() => null);
    if (!baseline) return { available: false, reason: "no_baseline", parkedFile: state.parkedFile };
    return { available: true, diff: diffWorkbooks(baseline, parked), parkedFile: state.parkedFile };
  } catch (e) {
    return { available: false, reason: "error", parkedFile: state.parkedFile, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 치워 둔 파일의 바이트. 관리자 내려받기용(상태 표에 적힌 이름만 — 임의 경로를 받지 않는다). 없으면 null. */
export async function readParkedFile(): Promise<{ name: string; bytes: Buffer } | null> {
  const state = await getWorkbookState();
  if (!state?.parkedFile) return null;
  try {
    const bytes = await readFile(path.join(env.inventoryDataDir, state.parkedFile));
    return { name: state.parkedFile, bytes };
  } catch {
    return null;
  }
}
