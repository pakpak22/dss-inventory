import { isChargeType, isPurpose, isRecordableType, INTAKE_NUMBER_RE, type ChargeType, type Purpose, type RecordableType } from "./codes";

/**
 * 수량 변경 기록 폼의 **검사** — 순수 함수. 종류마다 받는 칸이 다르다 (DESIGN 2-4절).
 * 서버 액션이 부르고, 시험은 DB 없이 돈다. 🔴 클라이언트가 보낸 값은 전부 다시 검사한다.
 *
 * 부품 줄은 폼이 JSON 글자 하나(`lines`)로 보낸다 — 줄 수가 그때그때 달라 이름 붙인 칸으로는 받기 번거롭다.
 */

export interface UseLine {
  partId: string;
  quantity: number;
  chargeType: ChargeType;
  note: string;
  /** 「실제 수량이 다릅니다」 — 적으면 저장할 때 조정 기록이 함께 남는다 */
  actualQuantity: number | null;
}
export interface SimpleLine {
  partId: string;
  quantity: number;
  note: string;
}
export interface ReturnLine {
  /** 되돌리는 원래 사용·대여 줄 */
  transactionId: string;
  quantity: number;
  note: string;
}

export type EntryInput =
  | { type: "USE"; occurredOn: string; intakeNumber: string; noRepairCase: boolean; reason: string; purpose: Purpose; purposeText: string; note: string; lines: UseLine[] }
  | { type: "RECEIVE"; occurredOn: string; note: string; lines: SimpleLine[] }
  | { type: "RETURN"; occurredOn: string; note: string; lines: ReturnLine[] }
  | { type: "DISPOSE"; occurredOn: string; reason: string; note: string; lines: SimpleLine[] }
  | { type: "ADJUST"; occurredOn: string; reason: string; note: string; partId: string; actualQuantity: number }
  | { type: "TRANSFER"; occurredOn: string; note: string; fromPartId: string; toPartId: string; quantity: number }
  | { type: "LOAN"; occurredOn: string; counterparty: string; note: string; lines: SimpleLine[] };

export type EntryFieldErrors = Partial<Record<string, string>>;
export type ParseEntryResult = { ok: true; value: EntryInput } | { ok: false; errors: EntryFieldErrors };

type FormLike = { get(name: string): FormDataEntryValue | string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QTY = 1_000_000;
const MAX_LINES = 50;

function text(fd: FormLike, name: string, max = 500): string {
  const v = fd.get(name);
  const s = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  return s.length > max ? s.slice(0, max) : s;
}

/** 날짜: YYYY-MM-DD, 실제로 있는 날, 2000년 이후, 내일(서울)까지. */
export function parseOccurredOn(raw: string, todayIso: string): string | null {
  if (!DATE_RE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return null;
  if (raw < "2000-01-01") return null;
  const tomorrow = new Date(`${todayIso}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (raw > tomorrow.toISOString().slice(0, 10)) return null;
  return raw;
}

function qty(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return null;
  return n;
}

function parseLinesJson(fd: FormLike): unknown[] | null {
  const raw = fd.get("lines");
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function noteOf(o: Record<string, unknown>): string {
  return typeof o.note === "string" ? o.note.trim().slice(0, 500) : "";
}

function parseSimpleLines(fd: FormLike, errors: EntryFieldErrors): SimpleLine[] {
  const raw = parseLinesJson(fd);
  if (raw === null) {
    errors.lines = "부품 줄을 읽지 못했습니다. 다시 시도하십시오.";
    return [];
  }
  if (raw.length === 0) {
    errors.lines = "부품을 하나 이상 고르십시오.";
    return [];
  }
  if (raw.length > MAX_LINES) {
    errors.lines = `한 건에 ${MAX_LINES}줄까지입니다.`;
    return [];
  }
  const out: SimpleLine[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const o = asRecord(item);
    const partId = typeof o.partId === "string" ? o.partId : "";
    if (!UUID_RE.test(partId)) errors[`lines.${i}`] = "부품이 올바르지 않습니다.";
    else if (seen.has(partId)) errors[`lines.${i}`] = "같은 부품이 두 번 들어 있습니다. 한 줄에 수량을 합치십시오.";
    const q = qty(o.quantity);
    if (q === null) errors[`lines.${i}`] = `${i + 1}번째 줄: 수량은 1 이상의 정수입니다.`;
    seen.add(partId);
    if (q !== null) out.push({ partId, quantity: q, note: noteOf(o) });
  });
  return out;
}

export function parseEntryForm(fd: FormLike, todayIso: string): ParseEntryResult {
  const errors: EntryFieldErrors = {};
  const type = text(fd, "type");
  if (!isRecordableType(type)) return { ok: false, errors: { type: "기록 종류가 올바르지 않습니다." } };

  const occurredOn = parseOccurredOn(text(fd, "occurredOn"), todayIso);
  if (!occurredOn) errors.occurredOn = "날짜를 확인하십시오 (내일까지만 적을 수 있습니다).";
  const note = text(fd, "note", 1000);
  const day = occurredOn ?? todayIso;

  switch (type as RecordableType) {
    case "USE": {
      const noRepairCase = fd.get("noRepairCase") === "1";
      const intakeNumber = text(fd, "intakeNumber").toUpperCase();
      const reason = text(fd, "reason");
      if (noRepairCase) {
        if (reason.length < 2) errors.reason = "수리 건이 없는 반출은 사유를 적으십시오.";
      } else if (!INTAKE_NUMBER_RE.test(intakeNumber)) {
        errors.intakeNumber = "인수번호는 D 와 숫자 6자리입니다 (예: D260701). 수리 건이 없으면 「수리 건 없음」을 고르십시오.";
      }
      const purposeRaw = text(fd, "purpose");
      const purpose = isPurpose(purposeRaw) ? purposeRaw : null;
      if (!purpose) errors.purpose = "목적을 고르십시오.";
      const purposeText = text(fd, "purposeText");
      if (purpose === "OTHER" && purposeText.length < 1) errors.purposeText = "목적이 기타면 무엇인지 적으십시오.";

      const raw = parseLinesJson(fd);
      const lines: UseLine[] = [];
      if (raw === null) errors.lines = "부품 줄을 읽지 못했습니다. 다시 시도하십시오.";
      else if (raw.length === 0) errors.lines = "부품을 하나 이상 고르십시오.";
      else if (raw.length > MAX_LINES) errors.lines = `한 건에 ${MAX_LINES}줄까지입니다.`;
      else {
        const seen = new Set<string>();
        raw.forEach((item, i) => {
          const o = asRecord(item);
          const partId = typeof o.partId === "string" ? o.partId : "";
          if (!UUID_RE.test(partId)) errors[`lines.${i}`] = "부품이 올바르지 않습니다.";
          else if (seen.has(partId)) errors[`lines.${i}`] = "같은 부품이 두 번 들어 있습니다. 한 줄에 수량을 합치십시오.";
          seen.add(partId);
          const q = qty(o.quantity);
          if (q === null) errors[`lines.${i}`] = `${i + 1}번째 줄: 수량은 1 이상의 정수입니다.`;
          const charge = isChargeType(o.chargeType) ? o.chargeType : null;
          if (!charge) errors[`lines.${i}`] = `${i + 1}번째 줄: 유상·무상을 고르십시오.`;
          let actualQuantity: number | null = null;
          if (o.actualQuantity !== null && o.actualQuantity !== undefined && o.actualQuantity !== "") {
            const a = typeof o.actualQuantity === "number" ? o.actualQuantity : Number(String(o.actualQuantity).replace(/,/g, ""));
            if (!Number.isInteger(a) || a < 0 || a > MAX_QTY) errors[`lines.${i}`] = `${i + 1}번째 줄: 실제 수량은 0 이상의 정수입니다.`;
            else actualQuantity = a;
          }
          if (q !== null && charge) lines.push({ partId, quantity: q, chargeType: charge, note: noteOf(o), actualQuantity });
        });
      }
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, value: { type: "USE", occurredOn: day, intakeNumber: noRepairCase ? "" : intakeNumber, noRepairCase, reason: noRepairCase ? reason : "", purpose: purpose!, purposeText: purpose === "OTHER" ? purposeText : "", note, lines } };
    }
    case "RECEIVE": {
      const lines = parseSimpleLines(fd, errors);
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, value: { type: "RECEIVE", occurredOn: day, note, lines } };
    }
    case "LOAN": {
      const counterparty = text(fd, "counterparty");
      if (!counterparty) errors.counterparty = "빌려준 곳을 적으십시오.";
      const lines = parseSimpleLines(fd, errors);
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, value: { type: "LOAN", occurredOn: day, counterparty, note, lines } };
    }
    case "DISPOSE": {
      const reason = text(fd, "reason");
      if (reason.length < 2) errors.reason = "폐기·불량 사유를 적으십시오.";
      const lines = parseSimpleLines(fd, errors);
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, value: { type: "DISPOSE", occurredOn: day, reason, note, lines } };
    }
    case "RETURN": {
      const raw = parseLinesJson(fd);
      const lines: ReturnLine[] = [];
      if (raw === null) errors.lines = "되돌릴 줄을 읽지 못했습니다. 다시 시도하십시오.";
      else if (raw.length === 0) errors.lines = "되돌릴 사용·대여 기록을 하나 이상 고르십시오.";
      else if (raw.length > MAX_LINES) errors.lines = `한 건에 ${MAX_LINES}줄까지입니다.`;
      else {
        const seen = new Set<string>();
        raw.forEach((item, i) => {
          const o = asRecord(item);
          const transactionId = typeof o.transactionId === "string" ? o.transactionId : "";
          if (!UUID_RE.test(transactionId)) errors[`lines.${i}`] = "되돌릴 기록이 올바르지 않습니다.";
          else if (seen.has(transactionId)) errors[`lines.${i}`] = "같은 기록이 두 번 들어 있습니다.";
          seen.add(transactionId);
          const q = qty(o.quantity);
          if (q === null) errors[`lines.${i}`] = `${i + 1}번째 줄: 수량은 1 이상의 정수입니다.`;
          if (q !== null) lines.push({ transactionId, quantity: q, note: noteOf(o) });
        });
      }
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, value: { type: "RETURN", occurredOn: day, note, lines } };
    }
    case "ADJUST": {
      const reason = text(fd, "reason");
      if (reason.length < 2) errors.reason = "조정 사유를 적으십시오.";
      const partId = text(fd, "partId");
      if (!UUID_RE.test(partId)) errors.partId = "부품을 고르십시오.";
      const a = Number(text(fd, "actualQuantity").replace(/,/g, ""));
      if (text(fd, "actualQuantity") === "" || !Number.isInteger(a) || a < 0 || a > MAX_QTY) errors.actualQuantity = "실제로 센 수량을 0 이상의 정수로 적으십시오.";
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, value: { type: "ADJUST", occurredOn: day, reason, note, partId, actualQuantity: a } };
    }
    case "TRANSFER": {
      const fromPartId = text(fd, "fromPartId");
      const toPartId = text(fd, "toPartId");
      if (!UUID_RE.test(fromPartId)) errors.fromPartId = "보내는 부품을 고르십시오.";
      if (!UUID_RE.test(toPartId)) errors.toPartId = "받는 부품을 고르십시오.";
      if (fromPartId && fromPartId === toPartId) errors.toPartId = "보내는 부품과 받는 부품이 같습니다.";
      const q = qty(text(fd, "quantity"));
      if (q === null) errors.quantity = "옮길 수량은 1 이상의 정수입니다.";
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return { ok: true, value: { type: "TRANSFER", occurredOn: day, note, fromPartId, toPartId, quantity: q! } };
    }
  }
}

/**
 * 기록 내역 「부품 찾기」의 찾을 곳. 주소에는 짧은 키로 (n No. · a 품명 · b 품명2 · d 도번 · p 교산 품번 · c 고객사 품명).
 * 키는 **이 목록 안에서만** 안 겹치면 된다 — 재고 현황의 찾을 곳(list-state.ts SEARCH_FIELDS)과는 별개의 주소 칸(`pf`)이다.
 *
 * 🔴 「고객사 품명」은 **부품**의 칸(`parts.customer_name`)이다. 아래 「내용」 찾기가 보는
 * 그 건의 **고객사 이름**(`stock_entries.customer_name`)과 다른 것이다 — 이름이 비슷하니 주의.
 */
export const PART_SEARCH_FIELDS = [
  { key: "n", label: "No." },
  { key: "a", label: "품명" },
  { key: "b", label: "품명2" },
  { key: "d", label: "도번" },
  { key: "p", label: "교산 품번" },
  { key: "c", label: "고객사 품명" },
] as const;
export type PartSearchField = (typeof PART_SEARCH_FIELDS)[number]["key"];
export const ALL_PART_SEARCH_FIELDS: readonly PartSearchField[] = PART_SEARCH_FIELDS.map((f) => f.key);

/** 기록 내역 필터 (주소 → 값). 이상한 값은 버린다. */
export interface EntryListFilter {
  type: RecordableType | "CORRECTION" | "OPENING" | null;
  from: string | null;
  to: string | null;
  /** 부품 찾기 글자. 어느 칸에서 찾을지는 partFields (2026-10-06: 사용자가 도번을 쳤는데 조용히 전체가 나왔다 → 체크로 고르게) */
  partText: string;
  /** 찾을 곳. 비지 않는다. */
  partFields: PartSearchField[];
  /** 담당 이름. 기록자(신청자)와 **확인자** 둘 다 본다 (2026-10-07: 확인자만 적힌 건이 「정영빈」 검색에서 빠졌다) */
  actor: string;
  /** 내용 찾기 (2026-10-07): 사유·빌려준 곳·비고·고객명·최종 사용자·제품 모델·사용처·목적 글자·줄 비고. 제목에 보이는 글자는 다 찾아진다. */
  text: string;
  intakeNumber: string;
  unverifiedOnly: boolean;
  page: number;
}

export function parseEntryListFilter(sp: Record<string, string | string[] | undefined>): EntryListFilter {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const typeRaw = one("type");
  const type = isRecordableType(typeRaw) || typeRaw === "CORRECTION" || typeRaw === "OPENING" ? (typeRaw as EntryListFilter["type"]) : null;
  const from = DATE_RE.test(one("from")) ? one("from") : null;
  const to = DATE_RE.test(one("to")) ? one("to") : null;
  const partText = one("part").trim().slice(0, 100);
  // 체크박스가 여럿이면 주소에 pf=n&pf=a 로 오고, 우리가 만든 링크는 pf=n,a 로 온다 — 둘 다 받는다
  const pfVals = sp.pf;
  const pfRaw = Array.isArray(pfVals) ? pfVals.join(",") : (pfVals ?? "");
  const picked = pfRaw ? pfRaw.split(",").filter((k): k is PartSearchField => (ALL_PART_SEARCH_FIELDS as readonly string[]).includes(k)) : [];
  const partFields = picked.length > 0 ? ALL_PART_SEARCH_FIELDS.filter((k) => picked.includes(k)) : [...ALL_PART_SEARCH_FIELDS];
  const page = Math.max(1, Number.parseInt(one("page") || "1", 10) || 1);
  return { type, from, to, partText, partFields, actor: one("actor").trim().slice(0, 50), text: one("text").trim().slice(0, 100), intakeNumber: one("intake").trim().toUpperCase().slice(0, 20), unverifiedOnly: one("unverified") === "1", page };
}
