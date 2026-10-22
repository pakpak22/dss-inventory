import "server-only";
import { env } from "@/lib/env";
import { INTAKE_NUMBER_RE } from "./codes";
import { repairCaseDate } from "./repair-case";

/**
 * 인수번호 확인 — A/S 의 읽기 전용 조회 통로 (DESIGN 7절). 담당자가 만들어 주는 주소·인증을 환경변수로 받는다.
 *
 * 🔴 아직 통로를 받지 못했다(2026-10-06). 주소가 비어 있으면 **「A/S 가 응답하지 않음」과 같게** 다룬다 —
 *    저장은 되고 `intake_unverified` 가 남아 기록 내역에서 걸러 나중에 다시 확인한다. 막아 두면 반출 기록이 빈다(승인).
 *
 * 통로의 응답 모양은 받는 날 여기 한 곳만 맞추면 된다 (`parseLookupResponse`). 화면·원장은 `IntakeInfo` 만 안다.
 */
export interface IntakeInfo {
  intakeNumber: string;
  customerName: string;
  endUser: string;
  productModel: string;
  productSerial: string;
  productLot: string;
  /**
   * 인수일 — **`"YYYY-MM-DD"` 글자다. 시각이 아니다.** (2026-10-22 에 A/S 가 일곱째 칸으로 더했다.)
   *
   * 🔴 **`new Date()`·`toISOString()` 을 거치지 마라.** A/S 쪽 `repair_cases.received_at` 은 시각이
   *    없는 날짜 전용 칸이고, A/S 는 그 글자를 **한 글자도 손대지 않고** 내보낸다(저쪽 통로 문서
   *    `API_FOR_INTERNAL_SYSTEMS.md` 2절). 받는 쪽이 Date 로 한 번 바꾸면 자정이 UTC 로 해석되면서
   *    **하루가 밀린다** — 그러고도 오류가 안 나서 아무도 모른다. 글자로 받아 글자로 저장하고 글자로
   *    그린다.
   * 🔵 **빈 글자일 수 있다**: 통로가 안 보내던 시절의 응답이거나, 모양이 깨져 아래 `isoDate` 에서
   *    떨어진 경우다. 나머지 다섯 칸이 비는 것과 같은 자리이고 화면은 비면 안 그린다.
   */
  receivedAt: string;
}

export type IntakeLookupResult =
  | { status: "found"; info: IntakeInfo }
  | { status: "not_found" }
  | { status: "bad_format" }
  | { status: "unreachable"; reason: "not_configured" | "timeout" | "error" };

const TIMEOUT_MS = 5000;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v);
}

/**
 * 통로 응답(JSON) → IntakeInfo. 키 이름이 다르게 오면 여기만 고친다.
 *
 * 🔵 **인수일을 받는 규칙만 여기 안 적혀 있다** — 순수 함수 `repairCaseDate` 한 곳이다
 *    (`./repair-case.ts`). 이 파일은 `server-only` 라 시험이 import 할 수 없어서, 「받은 것을
 *    믿지 않는다」를 여기 적으면 **아무도 돌려 보지 못한다.** 거기 두면 시험이 전수를 돌린다.
 */
function parseLookupResponse(json: unknown, intakeNumber: string): IntakeInfo | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const src = (o.data && typeof o.data === "object" ? o.data : o) as Record<string, unknown>;
  const model = str(src.productModel ?? src.product_model ?? src.model_name ?? src.modelName);
  if (!model && !str(src.customerName ?? src.customer_name)) return null;
  return {
    intakeNumber: str(src.intakeNumber ?? src.intake_number) || intakeNumber,
    customerName: str(src.customerName ?? src.customer_name),
    endUser: str(src.endUser ?? src.end_user),
    productModel: model,
    productSerial: str(src.productSerial ?? src.product_serial ?? src.serial_number ?? src.serialNumber),
    productLot: str(src.productLot ?? src.product_lot ?? src.lot_number ?? src.lotNumber),
    // 🔴 글자 그대로. 🔵 모델·고객사가 있으면 이 칸이 비어도 「찾았다」이다 — 2026-10-22 전의 응답에는
    //    이 칸 자체가 없고, 그렇다고 그 수리 건을 못 찾은 것으로 다루면 반출 신청이 통째로 막힌다.
    receivedAt: repairCaseDate(src.receivedAt ?? src.received_at),
  };
}

export async function lookupIntake(intakeNumber: string): Promise<IntakeLookupResult> {
  const n = intakeNumber.trim().toUpperCase();
  if (!INTAKE_NUMBER_RE.test(n)) return { status: "bad_format" };

  const base = env.asLookupUrl;
  if (!base) return { status: "unreachable", reason: "not_configured" };

  const url = base.includes("{number}") ? base.replace("{number}", encodeURIComponent(n)) : `${base.replace(/\/+$/, "")}/${encodeURIComponent(n)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = env.asLookupToken;
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) {
      console.error("[intake-lookup] A/S 응답", res.status);
      return { status: "unreachable", reason: "error" };
    }
    const info = parseLookupResponse(await res.json(), n);
    return info ? { status: "found", info } : { status: "not_found" };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error("[intake-lookup] 실패:", aborted ? "시간 초과" : e instanceof Error ? e.message : e);
    return { status: "unreachable", reason: aborted ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

/** 엑셀 사용처 칸 글자 `인수번호_기종_S/N_L/N`. 재고 쪽에서 조립한다 (10절 6번). 빈 조각은 뺀다. */
export function buildUsagePlace(info: Pick<IntakeInfo, "intakeNumber" | "productModel" | "productSerial" | "productLot">): string {
  return [info.intakeNumber, info.productModel, info.productSerial, info.productLot].filter((s) => s !== "").join("_");
}

export const LOOKUP_MESSAGES = {
  bad_format: "인수번호는 D 와 숫자 6자리입니다 (예: D260701).",
  not_found: "그런 인수번호가 A/S 에 없습니다.",
  not_configured: "A/S 조회 통로가 아직 연결되지 않았습니다. 저장은 되고 「인수번호 확인 안 됨」 표시가 남습니다.",
  timeout: "A/S 가 응답하지 않습니다. 저장은 되고 「인수번호 확인 안 됨」 표시가 남습니다.",
  error: "A/S 조회에 실패했습니다. 저장은 되고 「인수번호 확인 안 됨」 표시가 남습니다.",
} as const;
