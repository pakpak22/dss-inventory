import Link from "next/link";
import type { ReactNode } from "react";
import { CorrectButton, ReverifyButton } from "@/components/stock/EntryActions";
import { roleAtLeast } from "@/lib/auth/role";
import { requireSession } from "@/lib/auth/session";
import { OWNER_LABEL, formatQuantity } from "@/lib/parts/codes";
import { PART_FIELDS, type PartFieldKey } from "@/lib/parts/field-order";
import { CHARGE_LABEL, ENTRY_TYPES, ENTRY_TYPE_LABEL, PURPOSE_LABEL, formatDelta, sheetNoText, sheetOf, type Sheet } from "@/lib/stock/codes";
import { ALL_PART_SEARCH_FIELDS, PART_SEARCH_FIELDS, parseEntryListFilter } from "@/lib/stock/form";
import { requestSavedNotice, type RequestNotice } from "@/lib/stock/request-notice";
import { listEntries, type EntryLineRow, type EntryRow } from "@/lib/stock/queries";

/**
 * 기록 내역 `/entries` (모두, DESIGN 2-5절). 날짜 역순, 종류·기간·부품·담당·인수번호·「인수번호 확인 안 됨」으로 거르기.
 * [기록 취소] 는 관리자, [확인] 은 기록·관리자. 거르기는 주소에 담는다(평범한 GET 폼).
 *
 * 🔴 **맨 위의 「확인 대기」 구역은 2026-10-15 사용자 결정으로 걷어냈다.** 같은 날 생긴 부품 요청 관리
 *    (`/requests`)가 **같은 신청을 상태까지 다 보여 주어** 한 신청이 두 화면에 뜨고 있었다. 신청을 보고
 *    처리하는 자리는 이제 `/requests` 하나이고(머리말 「대기 N」 배지도 그 옆에 선다), 여기는 **수량이
 *    움직인 기록**만 다룬다. 신청자가 자기 신청을 거두는 [신청 취소]도 그 화면으로 옮겼다 —
 *    기능이 사라진 것이 아니라 자리가 하나로 모인 것이다(`RequestManagerScreen`).
 */
export const metadata = { title: "기록 내역" };

const FLABEL = "flex flex-col gap-1.5 text-sm font-medium text-zinc-700";
const FINPUT = "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900";
const BTN = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100";
const BADGE = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";
/**
 * 다섯 칸의 **값과 꼴**. 🔴 차례는 여기 없다 — `PART_FIELDS` 를 돌면서 이 표를 찾아 쓴다(2026-10-16).
 * 줄이 들고 있는 칸 이름은 `part` 가 앞에 붙어(`partName2`) 부품 쪽 칸 이름과 다르므로 여기서 잇는다.
 */
const ENTRY_PART_CELL: Record<PartFieldKey, { td: string; inner?: string; of: (l: EntryLineRow) => string }> = {
  // 고객사 품명은 아주 긴 이름이 와도 이미 넓은 이 표가 더 밀리지 않게 안쪽 칸에 상한을 두고 넘치면 …
  // (전체는 마우스를 올리면 보인다). 🔵 **표만의 꼴**이다 — 카드는 제 줄을 통째로 받아 다 보인다.
  customerName: { td: "", inner: "block max-w-48 truncate", of: (l) => l.partCustomerName },
  name: { td: "font-medium whitespace-nowrap text-zinc-900", of: (l) => l.partName },
  name2: { td: "whitespace-nowrap", of: (l) => l.partName2 },
  kyosanPartNo: { td: "font-mono whitespace-nowrap", of: (l) => l.partKyosanPartNo },
  drawingNo: { td: "font-mono whitespace-nowrap", of: (l) => l.partDrawingNo },
};

/**
 * ============================================================================
 * 🔴 **열이 세 갈래라는 것을 적는 자리는 여기 하나다** (2026-10-22)
 * ============================================================================
 * 세부사항 표의 열은 `sheet` 에 따라 다르다 — 인수번호는 사용처 기입란에만, 종류·담당·상대는
 * 수량 변경 기록에만, 유상·무상과 사용처는 사용처 기입란에만 선다. 가운데 수량 열은
 * **이름표까지 갈린다**(사용 재고 / 입고 / 변동).
 *
 * 🔴 **그 갈래를 markup 에 다시 적지 않는다.** 2026-10-22 까지는 `<thead>` 와 `<tbody>` 가 같은
 *    갈림을 **각각** 들고 있었다. 거기에 좁은 화면용 카드까지 더하면 같은 조건이 세 벌이 되고,
 *    칸 하나가 갈래를 옮기는 날 **한쪽만 고쳐져 값이 조용히 어긋난다** — 오류가 나지 않아 아무도
 *    모른다(이 저장소에는 화면 렌더 시험이 없다).
 * 🔵 **그래서 그리는 쪽 셋이 전부 이 함수를 돈다**: 표 머리글 · 표 본문 · 카드.
 * ============================================================================
 */
type EntryColumnKey =
  | "no"
  | "date"
  | "intake"
  | "kind"
  | PartFieldKey
  | "before"
  | "delta"
  | "after"
  | "purposeActor"
  | "actor"
  | "note"
  | "owner"
  | "charge"
  | "usagePlace"
  | "counterparty";

interface EntryColumn {
  readonly key: EntryColumnKey;
  readonly label: string;
  /** 숫자 칸 — 표에서는 오른쪽에 붙고, 카드에서는 수량 줄에 모인다. */
  readonly numeric?: boolean;
}

/**
 * 가운데 수량 열의 **이름표**. 🔴 시트마다 다르고 적는 자리는 여기 하나다 — 표와 카드가 같은 글자를 쓴다.
 */
const DELTA_LABEL: Record<Sheet, string> = { USE: "사용 재고", RECEIVE: "입고", CHANGE: "변동" };

/** 이 시트에서 **그릴 칸과 그 이름표**. 차례도 갈래도 여기서만 정해진다. */
function entryColumns(sheet: Sheet): readonly EntryColumn[] {
  // 🔵 이름을 `useOnly` 로 짓지 마라 — lint 가 React Hook 으로 읽어 막는다(2026-10-22 실측).
  const onlyUse = (c: EntryColumn): EntryColumn[] => (sheet === "USE" ? [c] : []);
  const onlyChange = (c: EntryColumn): EntryColumn[] => (sheet === "CHANGE" ? [c] : []);
  return [
    { key: "no", label: "No." },
    { key: "date", label: "날짜" },
    ...onlyUse({ key: "intake", label: "인수번호" }),
    ...onlyChange({ key: "kind", label: "종류" }),
    // 🔴 다섯 칸의 차례는 `PART_FIELDS` 한 표가 쥔다 — 여기서 다시 적지 않는다.
    //    2026-10-16 까지 이 화면만 **교산 품번과 도번이 뒤바뀌어** 있었다.
    ...PART_FIELDS.map((x) => ({ key: x.key, label: x.label })),
    { key: "before", label: "현 재고", numeric: true },
    { key: "delta", label: DELTA_LABEL[sheet], numeric: true },
    { key: "after", label: "이후 재고", numeric: true },
    ...onlyUse({ key: "purposeActor", label: "목적 및 출하담당" }),
    ...onlyChange({ key: "actor", label: "담당" }),
    { key: "note", label: "비고" },
    { key: "owner", label: "소유" },
    ...onlyUse({ key: "charge", label: "유상·무상" }),
    ...onlyUse({ key: "usagePlace", label: "사용처" }),
    ...onlyChange({ key: "counterparty", label: "상대" }),
  ];
}

/** 다섯 칸 중 하나인가. 값과 꼴을 `ENTRY_PART_CELL` 로 넘길 때 쓴다. */
const PART_FIELD_KEY_SET: ReadonlySet<string> = new Set(PART_FIELDS.map((x) => x.key));
function isPartFieldKey(key: EntryColumnKey): key is PartFieldKey {
  return PART_FIELD_KEY_SET.has(key);
}

/** 「목적/출하담당」 한 덩이. 목적이 없으면 기록자 이름만 선다. */
function purposeActorOf(e: EntryRow): string {
  return e.purpose ? `${e.purpose === "OTHER" ? e.purposeText || "기타" : PURPOSE_LABEL[e.purpose]}/${e.createdByName}` : e.createdByName;
}

/** 비고 칸의 글자. 줄에 적힌 비고가 없으면 폐기·조정·기록 취소는 그 건의 사유가 대신 선다. */
function entryNoteText(e: EntryRow, l: EntryLineRow): string {
  return l.note || (e.type === "DISPOSE" || e.type === "ADJUST" || e.type === "CORRECTION" ? e.reason : "");
}

/** 사용처 칸의 글자. 수리 건이 없는 반출은 적어 둔 사유가 그 자리에 선다. */
function usagePlaceText(e: EntryRow): string {
  return e.usagePlace || (e.noRepairCase ? e.reason : "");
}

/** 상대 칸의 글자(수량 변경 기록). 대여는 빌려준 곳, 소유 옮김은 짝이 되는 줄, 반환은 되돌린 원래 기록. */
function counterpartyText(e: EntryRow, l: EntryLineRow): string {
  if (e.type === "LOAN") return e.counterparty;
  if (e.type === "TRANSFER")
    return e.lines
      .filter((o) => o.id !== l.id)
      .map((o) => `No. ${o.partNo} ${OWNER_LABEL[o.owner as keyof typeof OWNER_LABEL]}`)
      .join(", ");
  if (e.type === "RETURN" && l.returnsTransactionId) return "원래 기록 되돌림";
  return "";
}

/**
 * 칸 하나의 **값**을 그린다. 🔴 **표의 `<td>` 와 카드가 같은 이 함수를 쓴다** — 칸이 하나 늘 때 고칠
 *    자리가 한 군데여야 한다(`src/components/parts/PartsList.tsx` 의 `cellBody` 와 같은 까닭).
 * 🔵 **꼴은 여기 없다** — 칸 넓이·줄바꿈은 표가 `ENTRY_TD`·`ENTRY_PART_CELL` 로, 카드가 제 묶음으로 입힌다.
 * 🔵 **비었을 때 무엇을 적을지도 여기 없다** — 판정만 `isEntryCellBlank` 에 있고 처리는 부르는 쪽이 한다.
 */
function entryCellBody(e: EntryRow, l: EntryLineRow, key: EntryColumnKey): ReactNode {
  if (isPartFieldKey(key)) {
    // 품명 칸만 부품 상세로 가는 링크가 된다(이미 있는 길 `/?part=No.`). 나머지 넷은 값 그대로.
    if (key === "name")
      return (
        <Link href={`/?part=${l.partNo}`} className="underline decoration-zinc-300">
          <span className="font-normal text-zinc-500">No. {l.partNo}</span> {l.partName}
        </Link>
      );
    return ENTRY_PART_CELL[key].of(l);
  }
  switch (key) {
    case "no":
      return sheetNoText(e.type, e.sheetYear, e.sheetNo);
    case "date":
      return e.occurredOn;
    case "intake":
      return e.intakeNumber;
    case "kind":
      return ENTRY_TYPE_LABEL[e.type];
    case "before":
      return formatQuantity(l.quantityBefore);
    case "delta":
      // 수량 변경 기록만 +/− 를 함께 보인다(늘 수도 줄 수도 있다). 사용·입고는 방향이 정해져 있어 크기만.
      return sheetOf(e.type) === "CHANGE" ? formatDelta(l.delta) : formatQuantity(Math.abs(l.delta));
    case "after":
      return formatQuantity(l.quantityAfter);
    case "purposeActor":
      return purposeActorOf(e);
    case "actor":
      return e.createdByName;
    case "note":
      return (
        <>
          {entryNoteText(e, l)}
          {l.corrected ? <span className={`${BADGE} ml-1 bg-red-50 text-red-800 no-underline`}>취소됨</span> : null}
          {l.reversesTransactionId ? <span className="ml-1 text-zinc-500">(되돌림)</span> : null}
        </>
      );
    case "owner":
      return OWNER_LABEL[l.owner as keyof typeof OWNER_LABEL];
    case "charge":
      return l.chargeType ? CHARGE_LABEL[l.chargeType] : "";
    case "usagePlace":
      return usagePlaceText(e);
    case "counterparty":
      return counterpartyText(e, l);
    default: {
      // 🔴 칸이 하나 늘면 **여기서 타입 검사가 멈춘다** — 표에만 더하고 카드를 잊는 일을 막는다.
      const unhandled: never = key;
      return unhandled;
    }
  }
}

/**
 * 그 칸에 **적을 값이 없나**. 🔴 판정은 여기 하나지만 **어떻게 할지는 그리는 쪽이 정한다** —
 * 표는 `-` 를 적어 자리를 지키고(열이 밀리면 안 된다), 카드는 아예 안 그린다(「도번 -」이 줄마다
 * 서면 카드만 길어지고 정작 있는 값이 묻힌다). `PartsList.tsx` 의 `isBlank` 와 같은 규칙이다.
 * 🔵 수량·날짜·소유처럼 **늘 값이 있는 칸**은 여기 없다(기본은 「비지 않았다」). 수량은 `0` 도 값이다.
 * 🔵 품명은 비어도 **링크가 서야 해서** 비었다고 하지 않는다 — 그 칸이 부품을 가리키는 자리다.
 */
function isEntryCellBlank(e: EntryRow, l: EntryLineRow, key: EntryColumnKey): boolean {
  if (isPartFieldKey(key)) return key !== "name" && ENTRY_PART_CELL[key].of(l) === "";
  switch (key) {
    case "intake":
      return e.noRepairCase || e.intakeNumber === "";
    case "note":
      return entryNoteText(e, l) === "" && !l.corrected && !l.reversesTransactionId;
    case "charge":
      return l.chargeType === null;
    case "usagePlace":
      return usagePlaceText(e) === "";
    case "counterparty":
      return counterpartyText(e, l) === "";
    default:
      return false;
  }
}

/**
 * [기록 취소] 단추. 🔴 **표의 마지막 칸과 카드의 맨 아랫줄이 같은 이 함수를 쓴다** — 누가 누를 수
 * 있는지(관리자 · 아직 취소되지 않은 줄 · 기록 취소 줄 자신은 제외)와 확인 상자에 뜨는 글이 두 곳에
 * 적히면 한쪽만 고쳐진다.
 */
function correctButtonFor(e: EntryRow, l: EntryLineRow, isAdmin: boolean): ReactNode {
  if (!isAdmin || l.corrected || e.type === "CORRECTION") return null;
  return <CorrectButton transactionId={l.id} label={`${e.occurredOn} ${ENTRY_TYPE_LABEL[e.type]} · No. ${l.partNo} ${l.partName} ${formatDelta(l.delta)}`} />;
}

/** 칸마다의 `<td>` 꼴 — **표만의 것**이다(차례도 이름표도 여기 없다). 다섯 칸은 `ENTRY_PART_CELL` 이 쥔다. */
const ENTRY_TD: Record<Exclude<EntryColumnKey, PartFieldKey>, string> = {
  no: "tabular whitespace-nowrap text-zinc-500",
  date: "tabular whitespace-nowrap",
  intake: "font-mono whitespace-nowrap",
  kind: "whitespace-nowrap",
  before: "tabular text-right whitespace-nowrap",
  delta: "tabular text-right whitespace-nowrap font-semibold",
  after: "tabular text-right whitespace-nowrap",
  purposeActor: "whitespace-nowrap",
  actor: "whitespace-nowrap",
  note: "max-w-64",
  owner: "whitespace-nowrap",
  charge: "whitespace-nowrap",
  usagePlace: "font-mono whitespace-nowrap",
  counterparty: "whitespace-nowrap",
};

/** 🔵 비고만 빈 채로 둔다 — 원래 그랬고, 넓은 칸에 `-` 가 서면 없는 말이 있는 말처럼 눈에 띈다. */
const TABLE_DASH_SKIP: ReadonlySet<EntryColumnKey> = new Set<EntryColumnKey>(["note"]);

/** 카드 **맨 윗줄**에 서는 칸. 🔵 갈래는 여기서 다시 가르지 않는다 — `entryColumns` 가 이미 가른 것을 거를 뿐이다. */
const CARD_HEAD: ReadonlySet<EntryColumnKey> = new Set<EntryColumnKey>(["no", "date", "intake", "kind"]);
/** 카드에서 **한 줄에 모으는 수량 셋**. 가운데 칸의 이름표도 `entryColumns` 에서 온다. */
const CARD_QUANTITY: ReadonlySet<EntryColumnKey> = new Set<EntryColumnKey>(["before", "delta", "after"]);
/**
 * 카드에서 **제 줄을 통째로 받는 칸**. 긴 글이 올 수 있어 이름표와 값을 한 쌍으로 묶어 둘 수 없다
 * (`inline-block whitespace-nowrap` 규칙의 예외). 🔵 **차례를 적는 자리가 아니다** — 어느 칸이
 * 예외인지만 쥔다. 차례는 `entryColumns` 가 그대로 쥔다.
 */
const CARD_FULL_LINE: ReadonlySet<EntryColumnKey> = new Set<EntryColumnKey>(["customerName", "name", "note", "usagePlace", "counterparty"]);

const TH = "px-2 py-1.5 font-medium whitespace-nowrap";
const TD = "px-2 py-1 align-top";

/** 저장 결과 한 줄. 회색은 알림, 주황은 **아직 남은 것이 있다**는 뜻 (부품 요청 관리 화면과 같은 모양). */
const NOTICE: Record<RequestNotice["tone"], string> = {
  info: "rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700",
  warn: "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900",
};

function typeBadge(type: EntryRow["type"]) {
  const color =
    type === "RECEIVE" || type === "RETURN" || type === "OPENING"
      ? "bg-emerald-50 text-emerald-800"
      : type === "USE" || type === "LOAN" || type === "DISPOSE"
        ? "bg-blue-50 text-blue-800"
        : type === "CORRECTION"
          ? "bg-red-50 text-red-800"
          : "bg-zinc-100 text-zinc-700";
  return <span className={`${BADGE} ${color}`}>{ENTRY_TYPE_LABEL[type]}</span>;
}

/**
 * 대제목 (2026-10-06 사용자 요청): 수리 건이면 **인수번호**, 수리 건이 없는 사용이면 「기타 사용」, 나머지는 종류와 상대·사유.
 * 아래 표는 엑셀 사용처 기입란·입고 기입란·수량 변경 기록의 칸을 그대로 보인다.
 */
function entryTitle(e: EntryRow): string {
  switch (e.type) {
    case "USE":
      return e.noRepairCase ? `기타 사용${e.reason ? ` — ${e.reason}` : ""}` : e.intakeNumber;
    case "LOAN":
      return `대여${e.counterparty ? ` — ${e.counterparty}` : ""}`;
    case "DISPOSE":
      return `폐기·불량${e.reason ? ` — ${e.reason}` : ""}`;
    case "ADJUST":
      return `조정${e.reason ? ` — ${e.reason}` : ""}`;
    case "CORRECTION":
      return `기록 취소${e.reason ? ` — ${e.reason}` : ""}`;
    default:
      return ENTRY_TYPE_LABEL[e.type];
  }
}

export default async function EntriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession("/entries");
  const canRecord = roleAtLeast(session.user.role, "STAFF");
  const isAdmin = roleAtLeast(session.user.role, "ADMIN");
  const sp = await searchParams;
  const f = parseEntryListFilter(sp);
  /**
   * **기록이 저장된** 뒤의 한 줄 — 기록 번호와 「인수번호 확인 안 됨」 (2026-10-15, 조각 10c).
   *
   * 🔴 **남긴 까닭**: 바로 원장에 적히는 길이 아직 이 화면으로 온다 — [기록 취소](`correctTransactionAction`)가
   *    `?saved=CH-…&type=CORRECTION` 으로 돌아온다. 지우면 취소해 놓고 아무 말이 없어진다.
   * 🔴 **결정 알림(`requestDecisionNotice` — 반려·마감·보류·보류 해제·신청 취소)은 걷어냈다.** 그 꼬리표는
   *    요청 단추가 붙이는 것이고, 단추는 이제 부품 요청 관리(`/requests`)에만 있다.
   * 🔵 문구는 그 화면과 **같은 한 벌**에서 온다(`request-notice.ts`) — 같은 일을 두 화면이 다르게 말하지 않게.
   */
  const savedNotice = requestSavedNotice(sp, "entries");
  const { rows, total, pageSize } = await listEntries(f);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (f.page - 1) * pageSize + 1;
  const to = Math.min(total, f.page * pageSize);
  const hasFilter = Boolean(f.type || f.from || f.to || f.partText || f.actor || f.text || f.intakeNumber || f.unverifiedOnly);
  const partFieldLabels = PART_SEARCH_FIELDS.filter((x) => f.partFields.includes(x.key)).map((x) => x.label);
  const conditionText = [
    f.type ? `종류 ${ENTRY_TYPE_LABEL[f.type]}` : "",
    f.from || f.to ? `날짜 ${f.from ?? ""}~${f.to ?? ""}` : "",
    f.partText ? `부품 「${f.partText}」${f.partFields.length < ALL_PART_SEARCH_FIELDS.length ? ` (${partFieldLabels.join("·")}에서)` : ""}` : "",
    f.actor ? `담당 「${f.actor}」` : "",
    f.text ? `내용 「${f.text}」` : "",
    f.intakeNumber ? `인수번호 「${f.intakeNumber}」` : "",
    f.unverifiedOnly ? "인수번호 확인 안 됨만" : "",
  ].filter(Boolean);
  const href = (p: number) => {
    const q = new URLSearchParams();
    if (f.type) q.set("type", f.type);
    if (f.from) q.set("from", f.from);
    if (f.to) q.set("to", f.to);
    if (f.partText) q.set("part", f.partText);
    if (f.partFields.length < ALL_PART_SEARCH_FIELDS.length) q.set("pf", f.partFields.join(","));
    if (f.actor) q.set("actor", f.actor);
    if (f.text) q.set("text", f.text);
    if (f.intakeNumber) q.set("intake", f.intakeNumber);
    if (f.unverifiedOnly) q.set("unverified", "1");
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/entries?${s}` : "/entries";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-zinc-900">기록 내역</h1>
        {canRecord ? (
          <Link href="/entries/new" className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800">
            수량 변경 기록
          </Link>
        ) : null}
      </div>

      <p className="text-xs text-zinc-500">
        수량이 움직인 기록입니다. 잘못 적은 줄은 지우지 않고 <b>[기록 취소]</b>로 되돌리는 줄을 새로 쌓습니다(관리자). 「인수번호 확인 안 됨」은 A/S 가 응답하지 않아 확인을 미룬 것이고 [확인]으로 다시 묻습니다.
      </p>

      {/* 저장 결과 — 기록 번호와 「인수번호 확인 안 됨」. 🔵 글자는 부품 요청 관리와 같은 한 벌에서 온다(위 savedNotice 주석). */}
      {savedNotice ? <p className={NOTICE[savedNotice.tone]}>{savedNotice.text}</p> : null}

      <form method="get" action="/entries" className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 no-print">
        <h2 className="text-base font-semibold text-zinc-900">필터</h2>

        {/* 배치는 자주 쓰는 순서 (2026-10-07 사용자): 부품 → 인수번호·날짜·종류 → 담당·내용은 접어 둠(비고로 찾을 일은 거의 없음) */}
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <label className={FLABEL}>
            부품 찾기
            <input name="part" defaultValue={f.partText} className={FINPUT} placeholder="예: 7, AMP-DEH, WR10136, C0907…" />
          </label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm font-medium text-zinc-700">찾을 곳</span>
            {PART_SEARCH_FIELDS.map((x) => (
              <label key={x.key} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-zinc-800">
                <input type="checkbox" name="pf" value={x.key} defaultChecked={f.partFields.includes(x.key)} className="h-4 w-4" />
                {x.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className={FLABEL}>
            인수번호 (일부만 쳐도 됨)
            <input name="intake" defaultValue={f.intakeNumber} className={`${FINPUT} font-mono uppercase`} placeholder="예: D2607" aria-label="인수번호" />
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-normal text-zinc-800">
              <input type="checkbox" name="unverified" value="1" defaultChecked={f.unverifiedOnly} className="h-4 w-4" />
              인수번호 확인 안 됨만
            </label>
          </div>
          <div className={FLABEL}>
            날짜
            <div className="flex items-center gap-2">
              <input type="date" name="from" defaultValue={f.from ?? ""} className={FINPUT} aria-label="날짜 부터" />
              <span className="text-zinc-500">~</span>
              <input type="date" name="to" defaultValue={f.to ?? ""} className={FINPUT} aria-label="날짜 까지" />
            </div>
          </div>
          <label className={FLABEL}>
            종류
            <select name="type" defaultValue={f.type ?? ""} className={FINPUT}>
              <option value="">전체</option>
              {ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ENTRY_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <details open={Boolean(f.actor || f.text)} className="rounded-md border border-dashed border-zinc-300 px-3 py-2">
          <summary className="cursor-pointer text-sm text-zinc-600 select-none">담당·내용으로 찾기 (자주 안 씀)</summary>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={FLABEL}>
              담당 (신청자·기록자·확인자 이름)
              <input name="actor" defaultValue={f.actor} className={FINPUT} placeholder="예: 정영빈" />
            </label>
            <label className={FLABEL}>
              {/* 「고객명」 → 「고객사 이름」: 부품 찾기에 「고객사 품명」이 생겨 둘이 나란히 보인다. 다른 것이니 라벨을 갈라 둔다. */}
              내용 (사유·빌려준 곳·고객사 이름·사용처·비고)
              <input name="text" defaultValue={f.text} className={FINPUT} placeholder="예: 상해수리소, 불량, 실사…" />
            </label>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
            필터 적용
          </button>
          {hasFilter ? (
            <Link href="/entries" className={BTN}>
              조건 지우기
            </Link>
          ) : null}
          <span className="text-xs text-zinc-500">조건을 넣고 [필터 적용]을 누르거나 칸에서 Enter 를 치십시오.</span>
        </div>
      </form>

      {hasFilter ? (
        <p className="text-sm text-zinc-700">
          <span className="text-zinc-500">적용된 조건:</span> {conditionText.join(" · ")} <span className="text-zinc-500">→ {total}건</span>
        </p>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">{hasFilter ? "이 조건의 기록이 없습니다." : "아직 쌓인 기록이 없습니다."}</div>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {rows.map((e) => {
              // 🔴 이 건에서 **그릴 칸과 그 이름표**. 표 머리글·표 본문·카드가 모두 이 하나를 돈다(`entryColumns` 머리말).
              const cols = entryColumns(sheetOf(e.type));
              return (
                <li key={e.id} className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="tabular rounded-md bg-zinc-900 px-2 py-0.5 text-sm font-semibold text-white">{sheetNoText(e.type, e.sheetYear, e.sheetNo)}</span>
                    <h3 className="text-base font-semibold text-zinc-900">{entryTitle(e)}</h3>
                    {typeBadge(e.type)}
                    {e.intakeUnverified ? <span className={`${BADGE} bg-amber-100 text-amber-900`}>인수번호 확인 안 됨</span> : null}
                    <span className="tabular text-sm text-zinc-700">{e.occurredOn}</span>
                    <span className="text-sm text-zinc-700">
                      {e.confirmedByName ? (
                        <>
                          <span className="text-zinc-500">신청자:</span> <b>{e.createdByName}</b> <span className="text-zinc-500">· 확인자:</span> <b>{e.confirmedByName}</b>
                        </>
                      ) : (
                        <>
                          <span className="text-zinc-500">기록자:</span> <b>{e.createdByName}</b>
                        </>
                      )}
                    </span>
                    {e.intakeUnverified && canRecord ? <ReverifyButton entryId={e.id} /> : null}
                  </div>
                  {e.type === "USE" && (e.customerName || e.productModel || e.usagePlace) ? (
                    <p className="text-sm text-zinc-700">
                      {[e.customerName, e.productModel].filter(Boolean).join(" · ")}
                      {e.usagePlace ? <span className="font-mono text-xs text-zinc-500"> {e.usagePlace}</span> : null}
                    </p>
                  ) : null}
                  {e.note ? <p className="text-sm text-zinc-600">비고: {e.note}</p> : null}
                  {/*
                    ── 📱 **좁은 화면(lg 미만)은 세부사항 줄 하나가 카드 한 장이다** (2026-10-22 쓰는 분 요청) ──
                    아래 표는 열이 열 몇 개라 가로 스크롤이 있어도 폭 360px 짜리 휴대폰에서는 못 쓴다 —
                    첫 두 칸만 보이고 나머지는 화면 밖이다.

                    🔴 **카드는 칸 목록을 다시 적지 않는다** — 표와 **같은 `cols`**(`entryColumns`)를 돌고,
                       값은 표와 **같은 `entryCellBody`** 가 그린다. 세 갈래를 markup 에 또 적으면 칸 하나가
                       갈래를 옮기는 날 **한쪽만 고쳐져 값이 조용히 어긋난다**(`entryColumns` 머리말).
                    🔴 **겹치는 것은 배치뿐이다** — 1024px 이상에서는 아래 표가 지금 그대로 선다.
                    🔴 **인쇄는 언제나 표다**(`no-print`·`print:block`). 이 화면에는 [인쇄] 단추가 없지만
                       사람이 Ctrl+P 를 누른다 — 거르기 상자와 단추 칸에 `no-print` 가 붙어 있는 까닭이다.
                       A4 가로는 CSS 로 **약 1047px** 이라 `lg`(1024px) 경계에 아슬아슬하게 걸린다.
                       브라우저·여백·배율에 따라 1024px 아래로 떨어지면 **종이에 카드가 나간다.**
                       운에 맡기지 않고 못 박아 둔다(`tests/entry-detail-cards.test.ts` 가 이 두 글자를 잰다).
                  */}
                  <div className="no-print rounded-md border border-zinc-200 lg:hidden">
                    <ul className="divide-y divide-zinc-100">
                      {e.lines.map((l) => {
                        // 🔴 머리줄·수량 줄에 **이미 선 칸은 뺀다** — 같은 글자가 두 번 서면 카드만 길어진다.
                        // 🔵 값이 빈 칸도 뺀다(`isEntryCellBlank` 머리말).
                        const rest = cols.filter((c) => !CARD_HEAD.has(c.key) && !CARD_QUANTITY.has(c.key) && !isEntryCellBlank(e, l, c.key));
                        const correct = correctButtonFor(e, l, isAdmin);
                        return (
                          // 🔴 **취소된 줄은 카드에서도 회색 취소선이다** — 아래 `<tr>` 과 같은 글자다.
                          //    빠지면 되돌려진 줄이 멀쩡한 줄처럼 보인다(「취소됨」 딱지만 `no-underline` 으로 빠져나온다).
                          <li key={l.id} className={`flex flex-col gap-1 px-3 py-2.5 text-xs ${l.corrected ? "text-zinc-400 line-through" : ""}`}>
                            {/* 맨 윗줄: 기록 번호 · 날짜 · (사용처 기입란이면 인수번호 / 수량 변경 기록이면 종류) */}
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              {cols
                                .filter((c) => CARD_HEAD.has(c.key) && !isEntryCellBlank(e, l, c.key))
                                .map((c) => (
                                  <span key={c.key} className={`tabular whitespace-nowrap ${c.key === "no" ? "font-semibold text-zinc-900" : "text-zinc-500"}`}>
                                    {entryCellBody(e, l, c.key)}
                                  </span>
                                ))}
                            </div>
                            {/* 수량 셋은 한 줄에 모은다 — `.tabular` 로 세로가 맞는다.
                                🔴 가운데 칸의 **이름표가 시트마다 다르다**(사용 재고/입고/변동). 그 글자도 `cols` 에서 온다. */}
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                              {cols
                                .filter((c) => CARD_QUANTITY.has(c.key))
                                .map((c) => (
                                  <span key={c.key} className="inline-block whitespace-nowrap">
                                    <span className="text-zinc-400">{c.label} </span>
                                    <span className={`tabular text-sm ${c.key === "delta" ? "font-semibold" : ""}`}>{entryCellBody(e, l, c.key)}</span>
                                  </span>
                                ))}
                            </div>
                            {rest.length > 0 ? (
                              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-zinc-600">
                                {rest.map((c) => (
                                  /* 🔴 **이름표와 값은 한 쌍으로 붙어 다닌다** — 좁은 칸에서 이름표만 윗줄에 남고
                                      값이 아랫줄로 떨어진 적이 있다(`src/components/stock/RepairCaseInfo.tsx` 가 같은
                                      문제를 겪고 고친 방식 그대로다). `inline-block` 이 **함께** 있어야 쌍이 통째로
                                      내려간다 — `whitespace-nowrap` 만으로는 inline 상자가 쪼개진다.
                                      🔵 긴 글이 올 수 있는 칸만 제 줄을 받는다(`CARD_FULL_LINE`). */
                                  <span key={c.key} className={CARD_FULL_LINE.has(c.key) ? "basis-full break-keep" : "inline-block whitespace-nowrap"}>
                                    <span className="text-zinc-400">{c.label} </span>
                                    {entryCellBody(e, l, c.key)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {/* 맨 아래: 표의 마지막 칸과 **같은 단추**. 바깥 묶음이 `no-print` 라 종이에는 안 나간다. */}
                            {correct ? <div className="pt-0.5">{correct}</div> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="hidden overflow-x-auto rounded-md border border-zinc-200 lg:block print:block">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-zinc-50 text-left text-zinc-500">
                          {/* 🔴 머리글도 본문도 카드도 **같은 `cols`** 를 돈다. 2026-10-22 까지 머리글과 본문이
                              같은 `sheet` 갈림을 **따로** 들고 있었고, 다섯 칸의 차례도 `PART_FIELDS` 가 쥔다
                              (2026-10-16 까지 이 표만 교산 품번과 도번이 뒤바뀌어 있었다). */}
                          {cols.map((c) => (
                            <th key={c.key} className={`${TH} ${c.numeric ? "text-right" : ""}`}>
                              {c.label}
                            </th>
                          ))}
                          <th className={`${TH} no-print`} />
                        </tr>
                      </thead>
                      <tbody>
                        {e.lines.map((l) => (
                          <tr key={l.id} className={`border-t border-zinc-100 ${l.corrected ? "text-zinc-400 line-through" : ""}`}>
                            {cols.map((c) => {
                              // 🔵 **빈 칸에 `-` 를 적는 것은 표만의 규칙이다** — 열이 밀리면 안 된다(카드는 그 칸을 아예 안 그린다).
                              const body = isEntryCellBlank(e, l, c.key) && !TABLE_DASH_SKIP.has(c.key) ? "-" : entryCellBody(e, l, c.key);
                              const inner = isPartFieldKey(c.key) ? ENTRY_PART_CELL[c.key].inner : undefined;
                              return (
                                <td
                                  key={c.key}
                                  className={`${TD} ${isPartFieldKey(c.key) ? ENTRY_PART_CELL[c.key].td : ENTRY_TD[c.key]}`}
                                  title={c.key === "customerName" ? l.partCustomerName : undefined}
                                >
                                  {inner ? <span className={inner}>{body}</span> : body}
                                </td>
                              );
                            })}
                            <td className={`${TD} text-right whitespace-nowrap no-print`}>{correctButtonFor(e, l, isAdmin)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2.5 text-sm text-zinc-500">
          <span className="tabular">
            전체 {total}건 중 {from}-{to}건
          </span>
          <span className="flex items-center gap-2">
            {f.page > 1 ? (
              <Link href={href(f.page - 1)} className={BTN}>
                이전
              </Link>
            ) : (
              <span className={`${BTN} opacity-50`}>이전</span>
            )}
            <span className="tabular">
              {f.page} / {pages}
            </span>
            {f.page < pages ? (
              <Link href={href(f.page + 1)} className={BTN}>
                다음
              </Link>
            ) : (
              <span className={`${BTN} opacity-50`}>다음</span>
            )}
          </span>
        </div>
      </section>
    </div>
  );
}
