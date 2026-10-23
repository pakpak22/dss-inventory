import type { AuditAction } from "./audit";
import { PART_FIELD_LABEL, describeTarget } from "./audit-labels";
import type { LoginErrorCode } from "./auth/errors";
// 기간 글자는 위임 화면과 **같은 함수**로 만든다 — 두 곳이 따로 적으면 하루짜리 위임이 한쪽에서만 다르게 보인다.
import { formatDelegationPeriod } from "./approval/delegation-screen";
import { PART_ISSUE_STATUS_LABELS } from "./approval/part-issue-rules";
import { APPROVAL_ROUTE_SCOPE_LABELS, type WorkflowKind } from "./approval/route";
import { formatFileSize } from "./file-size";
import { CATEGORY_LABEL, OWNER_LABEL, isCategory, isOwner } from "./parts/codes";
import { REQUEST_STATUS_LABEL } from "./stock/codes";

/**
 * ============================================================================
 * 변경 이력 `/audit` 의 **「내용」 칸 글자** — 순수 함수 (2026-10-23)
 * ============================================================================
 * 🔴 **이 저장소에는 화면 렌더 시험이 없다.** 그래서 화면이 혼자 쥐고 있으면 아무도 돌려 보지
 *    못하는 것을 순수 함수로 내려 둔다(`./approval/part-issue-screen.ts` 와 같은 규칙,
 *    `tests/part-issue-screen.test.ts` 머리말).
 *
 * ── 🔴 왜 옮겼나 ──────────────────────────────────────────────────────────
 * 이 규칙이 `audit/page.tsx` 안에 있던 동안 **분기를 빠뜨려도 아무도 몰랐다.** 불출 결재 계열
 * 다섯과 반출 신청 계열 여섯이 통째로 빠져 있었고, 오류는 한 번도 나지 않았다 — 모르는 모양은
 * JSON 을 그대로 내보내는 길로 조용히 떨어졌기 때문이다. 쓰는 분 화면에 이런 줄이 떠 있었다:
 *
 *     대상: 확인 대기 신청
 *     내용: {"note":"","entry":"USE-2026-8","issued":1,"issueNo":1,"summary":"사용 · …"}
 *
 * 🔴 **되돌아가는 길(`unknown: true`) 자체는 지우지 않았다.** 나중에 새 행위가 생겼을 때 숨기면
 *    원인을 못 찾는다(옮겨 오기 전 주석에 적혀 있던 그 까닭 그대로). 대신 **「지금 있는 행위는
 *    거기 안 떨어진다」를 시험이 지킨다** — `tests/audit-detail.test.ts` 가 `AUDIT_ACTIONS` 를
 *    전부 돌면서 `unknown === false` 를 본다. 행위를 하나 더하고 여기를 안 고치면 그 시험이 깨진다.
 *
 * ── 🔴 글자만 돌려준다. JSX 를 돌려주지 않는다 ────────────────────────────
 * 색·`<code>`·굵게 같은 **그리기는 화면(`audit/page.tsx`)의 몫**이다. 여기서 JSX 를 만들면 시험이
 * 리액트를 끌어와야 하고, 그 순간 이 파일을 내린 까닭이 사라진다.
 * 🔵 딱 하나 예외처럼 보이는 것이 `reason` 칸인데, 그것도 글자다 — 화면이 그 앞에 흐린 「사유」
 *    이름표를 붙여 한 줄로 그린다(아래 타입 주석).
 * ============================================================================
 */

export type AuditDetailLine =
  /**
   * 한 줄 설명.
   * 🔵 `reason` 이 있으면 화면이 `<글자> 사유 <reason>` 꼴로 그리고 「사유」만 흐리게 칠한다.
   *    부품 삭제·O/H 템플릿 삭제 두 곳이 예전부터 그렇게 그려 왔고, 그 모양을 그대로 지킨다.
   */
  | { kind: "text"; text: string; reason?: string }
  /** 앞·뒤 값을 가진 줄. 표의 [칸 · 변경 전 · 변경 후] 세 칸으로 그려진다. */
  | { kind: "field"; field: string; before: string; after: string };

export interface AuditDetailResult {
  lines: AuditDetailLine[];
  /**
   * 🔴 아는 모양이 아니어서 JSON 을 그대로 내보내야 하는가. **시험이 이 값을 본다.**
   * 참이면 `lines` 에는 `JSON.stringify(detail)` 한 줄만 들어 있고, 화면은 그것을 `<code>` 로 그린다.
   */
  unknown: boolean;
}

export interface AuditDetailContext {
  /**
   * 기록 id(uuid) → 기록 번호(「US-2026-8」). 옛 「엑셀 기준 적용」 줄이 번호 없이 uuid 만 남겼을 때
   * 화면이 미리 찾아 넣어 준다(`entryNosByIds`). 찾지 못한 id 는 그냥 빠진다.
   */
  entryNos: ReadonlyMap<string, string>;
}

/**
 * 적을 것이 **정말 없는** 줄. 🔴 빈 칸(`""`)과 다르다 — 빈 칸은 「빠뜨렸나?」로 읽히고, 이 글자는
 * 「일부러 비었다」로 읽힌다. 옛 줄 가운데 `detail` 을 아예 안 남긴 것이 여기로 온다.
 */
export const AUDIT_DETAIL_EMPTY = "—";

/**
 * **로그인 거절 사유** — 코드 하나당 한 토막.
 *
 * 🔴 `LOGIN_ERROR_MESSAGES`(`./auth/errors.ts`)를 그대로 쓰지 않는 까닭: 저쪽은 **거절당한 사람에게
 *    하는 말**이라 「다시 로그인해 주십시오」·「담당자(최희만)에게 요청하십시오」 같은 지시가 붙어
 *    있다. 이력을 읽는 사람은 이미 지나간 일을 되짚는 중이라 지시가 필요 없고, 표 한 칸에 들어가야
 *    해서 짧아야 한다. 두 벌이 된 것이 아니라 **쓰임이 다른 두 글자**다.
 * 🔴 `Record` 로 둔다 — 코드를 하나 더하고 여기를 안 고치면 **tsc 가 멈춘다**(이 저장소가
 *    `REQUEST_STATUS_LABEL`·`APPROVAL_ROUTE_SCOPE_LABELS` 에서 늘 쓰는 수법).
 */
export const LOGIN_REJECTED_CAUSE: Record<LoginErrorCode, string> = {
  state_mismatch: "로그인 왕복 확인값이 어긋남",
  tx_expired: "로그인 왕복 쿠키가 없거나 시간이 지남",
  portal_denied: "포털이 접근을 거절함",
  token_exchange_failed: "포털과 토큰 주고받기 실패",
  invalid_id_token: "포털이 준 로그인 정보를 확인하지 못함",
  unknown_role: "이 시스템에 없는 역할",
  no_role: "역할이 아직 지정되지 않음",
  portal_unreachable: "포털에 닿지 못함",
  account_disabled: "사용이 중지된 계정",
  server_error: "서버 오류",
};

/**
 * **수리 건 종류**의 화면 글자 (2026-10-22 에 들어온 `workflowKind`).
 *
 * 🔴 **절차 이름이 아니다.** 「매쳐」라는 종류가 어느 승인 절차로 가는지는 `./approval/route.ts` 의
 *    `approvalRouteScopeForWorkflowKind` 하나가 정하고, 그 짝은 바뀔 수 있다. 이력에는 **그때 받은
 *    종류 그대로** 적는다 — 절차 이름으로 바꿔 적으면 짝이 바뀐 날 옛 줄이 통째로 거짓이 된다.
 * 🔴 「매쳐」다. 「매처」·「메쳐」가 아니다(2026-10-22 사용자 결정, `APPROVAL_ROUTE_SCOPE_LABELS` 주석).
 */
export const REQUEST_WORKFLOW_KIND_LABEL: Record<WorkflowKind, string> = {
  MATCHER: "매쳐",
  GENERATOR: "제너레이터",
  TOTAL_CONTROLLER: "토탈 컨트롤러",
};

/* ------------------------------------------------------------------ */
/* 작은 도구들                                                          */
/* ------------------------------------------------------------------ */

const s = (v: unknown): string => String(v ?? "");
/** 숫자는 천 단위를 끊어 적는다. 숫자가 아닌 것(옛 줄의 빈 칸)은 0 으로 본다 — 기존 분기들의 관례 그대로. */
const n = (v: unknown): string => (typeof v === "number" ? v.toLocaleString("ko-KR") : String(v ?? 0));

/** 글자표에서 안전하게 뽑는다. 모르는 값은 **그대로** 보여 준다 — 숨기면 원인을 못 찾는다. */
function labelOf(table: Record<string, string>, value: unknown): string {
  const key = s(value);
  return key in table ? table[key] : key;
}

/** 기록 번호 글자. 「USE-2026-8」 → 「기록 사용 US-2026-8」. 대상 칸과 **같은 함수**를 쓴다. */
function entryText(entry: unknown): string {
  const raw = s(entry);
  return raw === "" ? "" : describeTarget(`entries:${raw}`);
}

/** 「이번 회차로 몇 개 내줬고 몇 개 남았나」 — 반출 확인·일부 불출·결재 실행 셋이 같은 말을 쓴다. */
function issuedLine(d: Record<string, unknown>): string {
  const head = entryText(d.entry);
  const rest = `${n(d.issueNo)}회차로 ${n(d.issued)}개 내줌 · ${d.remaining === 0 ? "남은 수량 없음" : `아직 ${n(d.remaining)}개 남음`}`;
  return head === "" ? rest : `${head} · ${rest}`;
}

/** 결재선 단계 줄. `APPROVAL_ROUTE_SAVED` 가 쓰던 꼴(「1. 홍길동 ▶ 2. 김철수」)을 그대로 쓴다. */
function stepNames(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return "(없음 — 절차를 쓰지 않음)";
  return (v as Array<{ stepOrder?: unknown; approverName?: unknown }>).map((step) => `${s(step.stepOrder)}. ${s(step.approverName)}`).join(" ▶ ");
}

const text = (t: string): AuditDetailLine => ({ kind: "text", text: t });

/**
 * O/H 템플릿 줄의 「기종 …」 토막. 🔴 **값이 있을 때만 돌려준다** — 없으면 빈 글자다.
 *
 * 기종 코드는 2026-10-15 에 없어져 그 뒤로 쌓인 줄에는 `code` 가 아예 없다. 그런데 글자를
 * 늘 붙이면 **「새 템플릿 · 기종  · 예시 O/H」** 처럼 빈 「기종 」 이 끼어 보인다
 * (2026-10-23 쓰는 분 신고). 🔵 그렇다고 글자를 지우면 **2026-10-15 이전 줄**에 들어 있는
 * 진짜 기종 코드까지 안 보인다 — 그것은 그때의 사실이라 보여야 한다.
 */
const ohCodePart = (code: unknown): string => (s(code) === "" ? "" : `기종 ${s(code)}`);

/** 아는 모양이 아닐 때. 🔴 JSON 을 **줄 하나에 담아** 돌려준다 — 화면이 `<code>` 로 그린다. */
export function unknownAuditDetail(detail: Record<string, unknown> | null): AuditDetailResult {
  return { lines: [text(JSON.stringify(detail))], unknown: true };
}

/**
 * 앞·뒤 값을 사람이 읽는 글자로. 금액에는 통화 기호를 붙인다 (2026-10-06 사용자 요청).
 * 견적가는 항상 원. 공급가는 그 기록에 남긴 통화(detail.supplyCurrency.before/after)를 따르고,
 * 그 값이 없는 옛 기록은 기본 통화(엔)로 본다.
 */
const CURRENCY_TEXT: Record<string, string> = { JPY: "¥ 엔", KRW: "₩ 원" };

export function auditValueText(field: string, v: unknown, currency: string): string {
  if (v === null || v === undefined || v === "") return "(없음)";
  if (field === "owner" && isOwner(v)) return OWNER_LABEL[v];
  if (field === "category" && isCategory(v)) return CATEGORY_LABEL[v];
  if (field === "supplyCurrency") return CURRENCY_TEXT[String(v)] ?? String(v);
  if (typeof v === "number") {
    const num = v.toLocaleString("ko-KR");
    if (field === "quotePrice") return `₩${num}`;
    if (field === "supplyPrice") return `${currency === "KRW" ? "₩" : "¥"}${num}`;
    return num;
  }
  return String(v);
}

/* ------------------------------------------------------------------ */
/* 본체                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 한 이력 줄의 「내용」을 글자 줄들로.
 *
 * 🔴 **「대상」 칸이 이미 말하는 것을 또 적지 않는다** — 대상이 「확인 대기 신청」이고 행위가 「반출
 *    보류」면 여기 적을 것은 **사유**뿐이다. 행위 이름표를 여기서 되풀이하면 표가 두 배로 길어지고
 *    정작 다른 한 칸이 묻힌다.
 * 🔴 **코드 값을 그대로 내보내지 않는다**(CLAUDE.md 10절) — 상태·절차·종류는 전부 글자표를 거친다.
 */
export function auditDetailLines(action: AuditAction, detail: Record<string, unknown> | null, ctx: AuditDetailContext): AuditDetailResult {
  /**
   * 🔴 **`detail` 을 아예 안 남기는 행위 둘이 먼저다.** 로그아웃과 「엑셀 다시 쓰기 시작」은 쓰는 쪽이
   *    `detail` 없이 남기므로 `null` 이고, 예전에는 그대로 **빈 칸**이 됐다(2026-10-23 까지).
   *    행위 이름표만으로 뜻이 서는 기록이지만, 빈 칸은 「빠진 건가」로 읽혀 이력을 훑는 사람을 멈춰
   *    세운다. 그래서 **그 줄만 읽고도 다음에 무슨 일이 일어났는지** 알 수 있는 한 줄을 적는다.
   * 🔴 쓰는 쪽(서버)은 한 글자도 고치지 않았다 — 이것은 **읽어서 보여 주는** 일이다.
   */
  if (action === "LOGOUT") {
    // 🔵 「포털 세션까지 끊었다」고 단정하지 않는다. 쓰는 쪽(`app/actions/auth.ts`)은 이 시스템을 먼저
    //    끊은 **뒤** 포털로 보내고, 포털이 꺼져 있으면 거기까지 못 간다. 확실한 것은 본인이 눌렀다는 것뿐.
    return { lines: [text("본인이 [로그아웃]을 눌러 나감 (세션이 저절로 만료된 것이 아니다)")], unknown: false };
  }
  if (action === "WORKBOOK_RESUMED") {
    return { lines: [text("멈춤을 풀었다 — 다음 차례부터 프로그램이 현황판 한 벌을 다시 쓴다")], unknown: false };
  }

  // 그 밖의 행위인데 내용이 비어 있는 줄(아주 옛 줄). 「null」을 그려 보여 주지 않는다.
  if (!detail) return { lines: [text(AUDIT_DETAIL_EMPTY)], unknown: false };
  const d = detail;

  switch (action) {
    /* ── 부품 ──────────────────────────────────────────────────── */
    case "PART_UPDATE": {
      if (!d.changes || typeof d.changes !== "object") break;
      const changes = d.changes as Record<string, { before: unknown; after: unknown }>;
      const cur = (d.supplyCurrency ?? {}) as { before?: unknown; after?: unknown };
      const curBefore = String(cur.before ?? changes.supplyCurrency?.before ?? "JPY");
      const curAfter = String(cur.after ?? changes.supplyCurrency?.after ?? "JPY");
      const lines: AuditDetailLine[] = Object.entries(changes).map(([field, c]) => ({
        kind: "field" as const,
        field: PART_FIELD_LABEL[field] ?? field,
        before: auditValueText(field, c.before, curBefore),
        after: auditValueText(field, c.after, curAfter),
      }));
      /**
       * 🔴 **바깥에서 채운 것이면 누가 채웠는지를 함께 보인다** (2026-10-16, 고객사 품명 통로).
       * 사람이 화면에서 고친 것과 A/S 통로로 들어온 것은 같은 행위(`PART_UPDATE`)로 남지만, 「이 이름
       * 누가 넣었지?」에 답할 자리가 이력뿐이다. 🔵 이름은 겹칠 수 있어 **포털 번호**까지 적는다
       * (반출 신청 취소에 「A/S 에서 거둠」을 적는 것과 같은 결). 옛 기록에는 이 칸이 없어 그대로 읽힌다.
       */
      const filledBy = d.filledBy as { sub?: unknown; name?: unknown } | undefined;
      if (filledBy) lines.push(text(`A/S 통로로 채움 · 보낸 이름 ${s(filledBy.name)} · 포털 번호 ${s(filledBy.sub)}`));
      return { lines: lines.length > 0 ? lines : [text("바뀐 칸 없음")], unknown: false };
    }
    case "PART_CREATE":
      return { lines: [text(`${s(d.name)}${d.name2 ? ` · ${s(d.name2)}` : ""}${d.owner && isOwner(d.owner) ? ` · ${OWNER_LABEL[d.owner]}` : ""}`)], unknown: false };
    case "PART_DELETE":
      return { lines: [{ kind: "text", text: s(d.name), reason: s(d.reason) }], unknown: false };
    case "PART_ITEM_CREATE":
      return { lines: [text(s(d.name))], unknown: false };
    case "PART_ITEM_REORDER":
      return { lines: [text(`${d.direction === "up" ? "위로" : "아래로"} (${s(d.swappedWith)} 와 자리 바꿈)`)], unknown: false };

    /* ── 수량 기록 ─────────────────────────────────────────────── */
    case "STOCK_ENTRY":
    case "STOCK_CORRECTION": {
      if (!Array.isArray(d.lines)) break;
      // 수량 기록: 부품 줄마다 [부품, 전, 후]. 자세한 것(인수번호·사유)은 기록 내역에서.
      const lines = (d.lines as Array<{ partNo?: unknown; delta?: unknown; before?: unknown; after?: unknown }>).map((l) => ({
        kind: "field" as const,
        field: `부품 No. ${s(l.partNo)} (${typeof l.delta === "number" ? (l.delta > 0 ? `+${l.delta}` : String(l.delta)) : ""})`,
        before: `${s(l.before)}개`,
        after: `${s(l.after)}개`,
      }));
      const head = `${s(d.occurredOn)}${d.intakeNumber ? ` · ${s(d.intakeNumber)}` : ""}${d.intakeUnverified ? " · 인수번호 확인 안 됨" : ""}`;
      return { lines: [text(head), ...lines], unknown: false };
    }
    case "INTAKE_VERIFIED":
      return { lines: [text(`${s(d.intakeNumber)} → ${s(d.productModel)}`)], unknown: false };

    /* ── 반출 신청 ─────────────────────────────────────────────── */
    /**
     * 🔴 **신청이 어디서 올라왔는지가 이력에만 남는다** (2026-10-23). 신청 표의 칸은 **지금** 값이고,
     *    「어디서 들어왔나」를 영영 들고 있는 것은 이 줄이다(쓰는 쪽 `createRequest` 주석).
     * 🔵 재고 관리에서 직접 올린 것은 **둘째 줄을 그리지 않는다** — 거의 전부가 그것이라 줄마다
     *    「재고 관리에서 올림」이 붙으면 눈에 띄어야 할 「A/S」가 묻힌다(`REQUEST_SOURCE_LABEL` 의 까닭).
     */
    case "STOCK_REQUEST": {
      const lines: AuditDetailLine[] = [text(s(d.summary))];
      if (d.source === "AS") {
        const who = [d.requesterName ? `보낸 이름 ${s(d.requesterName)}` : "", d.requesterSub ? `포털 번호 ${s(d.requesterSub)}` : ""].filter((v) => v !== "");
        // 🔵 재고 관리에 계정이 없는 사람일 수 있다 — 그때 `matchedUser` 가 `null` 이고, 그 사실이
        //    나중에 「왜 이 신청은 신청자가 못 거두나」의 답이 된다(`cancelRequest` 의 출처 조건).
        who.push(d.matchedUser ? `이 시스템 계정 ${s(d.matchedUser)}` : "이 시스템에 계정 없음");
        lines.push(text(`A/S 에서 올라옴 (요청 번호 ${s(d.externalKey)}) · ${who.join(" · ")}`));
      }
      const extra: string[] = [];
      if (d.intakeNumber) extra.push(`인수번호 ${s(d.intakeNumber)}`);
      // 「모름(null)」은 기존 「부품 불출」 절차로 간다 — 그 사실까지 적어야 나중에 「왜 저 절차를 탔나」가 풀린다.
      extra.push(d.workflowKind ? `수리 건 종류 ${labelOf(REQUEST_WORKFLOW_KIND_LABEL, d.workflowKind)}` : "수리 건 종류 모름 (기존 「부품 불출」 절차로 간다)");
      lines.push(text(extra.join(" · ")));
      return { lines, unknown: false };
    }
    /**
     * 반출 확인 · 일부 불출 — 🔴 **쓰는 분이 JSON 으로 보고 신고한 그 줄이다** (2026-10-23).
     * 둘은 같은 자리에서 「다 나갔나」로만 갈린다(`confirmRequest`). 글자도 같은 꼴을 쓰되
     * 남은 수량 한 토막이 둘을 가른다 — 「남은 수량 없음」 ↔ 「아직 N개 남음」.
     */
    case "STOCK_REQUEST_CONFIRMED":
    case "STOCK_REQUEST_PARTIAL": {
      const lines: AuditDetailLine[] = [text(`${s(d.summary)} (신청자 ${s(d.requestedBy)})`), text(issuedLine(d))];
      // 「2개는 다음 주에」처럼 담당자가 그 회차에 남기는 말. 비면 줄을 그리지 않는다(「없음」을 지어내지 않는다).
      if (d.note) lines.push(text(`담당자 메모: ${s(d.note)}`));
      return { lines, unknown: false };
    }
    // 반출 마감 — 🔴 반려와 **다르게** 읽혀야 한다(2026-10-14, 조각 4d). 준 것과 안 준 것을 숫자로 적는다.
    case "STOCK_REQUEST_CLOSED":
      return {
        lines: [
          text(`${s(d.summary)} (신청자 ${s(d.requestedBy)})`),
          text(`요청 ${n(d.requested)}개 중 ${n(d.issued)}개를 내주고, 남은 ${n(d.remaining)}개는 주지 않는 것으로 마감 · 사유: ${s(d.note)}`),
        ],
        unknown: false,
      };
    // 🔴 마감과 **다른 말이어야 한다** — 반려는 「하나도 안 준다」다. 둘이 같은 글자로 보이면
    //    나중에 「3개는 줬는데 왜 반려지?」가 된다(`STOCK_REQUEST_CLOSED` 의 까닭 그대로).
    case "STOCK_REQUEST_REJECTED":
      return { lines: [text(`${s(d.summary)} (신청자 ${s(d.requestedBy)})`), text(`하나도 내주지 않고 반려 · 사유: ${s(d.note)}`)], unknown: false };
    // 반출 신청 취소 — 🔴 **어디서 거뒀는지**가 보여야 한다 (2026-10-16, A/S 가 제 신청을 거두는 통로).
    // 화면에서 거둔 것과 A/S 통로로 거둔 것은 같은 행위(`STOCK_REQUEST_CANCELLED`)로 남지만, 「누가 접었나」를
    // 나중에 가릴 자리가 이력뿐이다. 🔵 출처 칸이 없는 옛 기록(화면 취소)은 요약 한 줄 그대로 읽힌다.
    case "STOCK_REQUEST_CANCELLED": {
      const fromAs = d.source === "AS" ? ` · A/S 에서 거둠 (요청 번호 ${s(d.externalKey)})` : "";
      return { lines: [text(`${s(d.summary)}${fromAs}`)], unknown: false };
    }
    // 보류 — 🔵 **사유만 적는다.** 「멈춰 둠」은 행위 이름표가 이미 말한다.
    //      🔴 사유가 영영 남는 곳이 이 줄뿐이다(신청 표의 `hold_reason` 은 풀 때 비워진다).
    case "STOCK_REQUEST_HELD":
      return { lines: [text(`${s(d.summary)} (신청자 ${s(d.requestedBy)})`), text(`사유: ${s(d.reason)}`)], unknown: false };
    // 보류 해제 — 🔵 **어느 자리로 돌려놨는지와 그렇게 정한 근거**(이미 나간 수량)를 적는다.
    //      쓰는 쪽이 둘을 함께 남긴 까닭이 「왜 PENDING 으로 갔지?」에 답하기 위해서다.
    case "STOCK_REQUEST_HOLD_RELEASED":
      return {
        lines: [text(`${s(d.summary)} (신청자 ${s(d.requestedBy)})`), text(`이미 나간 수량 ${n(d.issued)}개 · 「${labelOf(REQUEST_STATUS_LABEL, d.status)}」 자리로 돌려놓음`)],
        unknown: false,
      };

    /* ── 부품 불출 결재 여섯 ───────────────────────────────────── */
    /**
     * 🔴 **결재선은 그때 정해진 대로 굳는다.** 나중에 절차를 고쳐도 이 줄은 참말이라, 「누가 결재하게
     *    돼 있었나」를 되짚을 자리가 여기뿐이다(쓰는 쪽 `requestPartIssueApproval` 주석).
     * 🔵 `requestId` 는 **적지 않는다** — uuid 는 사람에게 뜻이 없다(`describeTarget` 이 결재건 uuid 를
     *    떼는 것과 같은 까닭). 어느 신청인지는 요약 글자가 말한다.
     * 🔵 `quantities` 는 통째로 내보내지 않는다 — 줄마다 부품 uuid 라 읽을 수 없고 길면 화면이 터진다.
     *    **센 숫자**로 푼다.
     */
    case "STOCK_ISSUE_APPROVAL_REQUESTED": {
      const steps = Array.isArray(d.steps) ? (d.steps as unknown[]) : [];
      const quantities = Array.isArray(d.quantities) ? (d.quantities as Array<{ quantity?: unknown }>) : [];
      const total = quantities.reduce((a, q) => a + (typeof q.quantity === "number" ? q.quantity : 0), 0);
      const lines: AuditDetailLine[] = [
        text(s(d.requestSummary)),
        text(
          `${labelOf(APPROVAL_ROUTE_SCOPE_LABELS, d.routeScope)} 절차 ${n(d.routeVersion)}번째 판 · ` +
            (d.autoApproved ? "결재할 사람이 없어 곧바로 승인됨 (이제 [실행]을 기다린다)" : `결재선 ${steps.length}단계: ${stepNames(steps)}`),
        ),
        text(`올린 수량 ${quantities.length}줄 · 모두 ${total.toLocaleString("ko-KR")}개 · 신청은 「${labelOf(REQUEST_STATUS_LABEL, d.requestStatus)}」 자리로`),
      ];
      if (d.reason) lines.push(text(`사유: ${s(d.reason)}`));
      return { lines, unknown: false };
    }
    // 🔴 「다음 단계로 넘어감」과 「결재 끝」을 **가른다**. 끝난 것이 아직 안 나간 것이고, 그 둘이 같은
    //    글자로 보이면 「승인은 났는데 왜 부품이 안 나갔지」를 이력에서 가려낼 수 없다.
    case "STOCK_ISSUE_APPROVAL_APPROVED": {
      const lines: AuditDetailLine[] = [
        text(`${n(d.stepOrder)}단계 승인 · ` + (d.status === "APPROVED" ? "마지막 단계라 결재 끝 (이제 [실행]을 기다린다)" : "다음 단계로 넘어감")),
      ];
      if (d.note) lines.push(text(`의견: ${s(d.note)}`));
      return { lines, unknown: false };
    }
    /**
     * 결재 중 반려. 🔴 **반출 신청까지 닫혔나**를 함께 적는다 — 2026-10-21 전에 올라간 건은 신청이
     * `IN_APPROVAL` 로 가지 않아 그대로 남고(쓰는 쪽이 일부러 던지지 않는다), 그 사실이 안 보이면
     * 「반려됐다는데 왜 대기 목록에 있지」의 답이 사라진다.
     */
    case "STOCK_ISSUE_APPROVAL_REJECTED":
      return {
        lines: [
          text(`${n(d.stepOrder)}단계에서 반려 · 결재건은 「${labelOf(PART_ISSUE_STATUS_LABELS, d.status)}」`),
          text(`사유: ${s(d.note)}`),
          text(d.requestRejected ? "반출 신청도 함께 닫음 (다시 필요하면 새로 신청한다)" : "반출 신청은 그대로 남음 — 담당자가 직접 처리한다"),
        ],
        unknown: false,
      };
    case "STOCK_ISSUE_APPROVAL_EXECUTED": {
      const lines: AuditDetailLine[] = [text(issuedLine(d))];
      if (d.note) lines.push(text(`담당자 메모: ${s(d.note)}`));
      return { lines, unknown: false };
    }
    // 🔴 결재 중 반려와 **다른 자리**다 — 결재는 다 끝났고 담당자가 [실행] 직전에 막았다.
    //    사유를 찾을 표가 다르므로(단계 줄이 아니라 결재건 칸) 이력에서도 다른 말이어야 한다.
    case "STOCK_ISSUE_APPROVAL_EXECUTION_REJECTED":
      return {
        lines: [text(`사유: ${s(d.reason)}`), text(d.requestRejected ? "반출 신청도 함께 닫음 (다시 필요하면 새로 신청한다)" : "반출 신청은 그대로 남음 — 담당자가 직접 처리한다")],
        unknown: false,
      };
    // 거둠 — 🔵 「어느 자리로 돌려놨나」가 보여야 한다. `requestStatus` 가 `null` 이면 신청이 애초에
    //        결재 쪽으로 가 있지 않았던 옛 건이라 되돌릴 것이 없었다는 뜻이다.
    case "STOCK_ISSUE_APPROVAL_CANCELLED":
      return {
        lines: [
          text(
            `이미 나간 수량 ${n(d.issued)}개 · ` +
              (d.requestStatus ? `반출 신청을 「${labelOf(REQUEST_STATUS_LABEL, d.requestStatus)}」 자리로 돌려놓음` : "반출 신청은 이미 담당자 손에 있어 그대로 둠"),
          ),
        ],
        unknown: false,
      };

    /* ── 로그인·로그아웃 ───────────────────────────────────────── */
    case "LOGIN":
      return { lines: [text(`역할 ${s(d.role)}`)], unknown: false };
    /**
     * 로그인 거절 — 🔴 **거절은 소리 없이 지나간다.** 거절당한 사람은 한국어 안내 한 줄만 보고 끝이라
     *    (「담당자에게 요청하십시오」), **무슨 일이 있었는지 아는 자리가 이 줄뿐이다.**
     * 🔵 개발자가 적어 둔 자세한 사유(`detail.detail`)도 둘째 줄에 그대로 싣는다 — 사람이 읽는 말은
     *    아니지만, 포털이 돌려준 오류 글자가 거기 들어 있어 담당자가 원인을 가리는 유일한 단서다.
     */
    case "LOGIN_REJECTED": {
      const who = [d.name ? `보낸 이름 ${s(d.name)}` : "", d.sub ? `포털 번호 ${s(d.sub)}` : ""].filter((v) => v !== "");
      const lines: AuditDetailLine[] = [text(`거절 사유: ${labelOf(LOGIN_REJECTED_CAUSE, d.code)}${who.length > 0 ? ` · ${who.join(" · ")}` : ""}`)];
      if (d.detail) lines.push(text(`자세한 사유: ${s(d.detail)}`));
      return { lines, unknown: false };
    }
    /**
     * 포털이 보내 온 로그아웃. 🔵 **사람이 이 시스템에서 누른 것이 아니다** — 포털에서 로그아웃하면
     * 포털 서버가 우리 통로를 두드린다. 끊긴 사람이 0명인 경우(그 포털 번호가 이 시스템에 없음)도
     * 정상이라, 숫자를 적어 둬야 「왜 아직 로그인돼 있지」를 따질 수 있다.
     */
    case "BACKCHANNEL_LOGOUT":
      return { lines: [text(`포털에서 로그아웃 알림을 받아 이 시스템 세션을 끊음 · 끊긴 사람 ${n(d.affected)}명 · 포털 번호 ${s(d.sub)}`)], unknown: false };

    /* ── 현황판 엑셀 ───────────────────────────────────────────── */
    // 엑셀 한 벌 관련 셋 — 파일 이름·건수를 글자로 (2026-10-12 사용자 지적: 엑셀 기준 적용 이력이 JSON 그대로 보였다)
    case "WORKBOOK_PARKED":
      return { lines: [text(`수기입 파일을 「${s(d.parkedFile)}」 로 따로 보관하고 멈춤${typeof d.size === "number" ? ` · ${formatFileSize(d.size)}` : ""}`)], unknown: false };
    case "WORKBOOK_EXCEL_APPLIED": {
      // 번호를 detail 에 남기기 전의 기록은 entryIds 로 번호를 찾아 보인다(entryNos 맵)
      const nos = Array.isArray(d.entryNos)
        ? (d.entryNos as unknown[]).map(String)
        : Array.isArray(d.entryIds)
          ? (d.entryIds as unknown[]).map((id) => ctx.entryNos.get(String(id))).filter((v): v is string => typeof v === "string")
          : [];
      const count = typeof d.entryCount === "number" ? d.entryCount : nos.length;
      const skipped = typeof d.skippedCount === "number" ? d.skippedCount : 0;
      return {
        lines: [
          text(`수기입 파일 「${s(d.parkedFile)}」 · 사유: ${s(d.reason)}`),
          text(s(d.summary)),
          text(`원장에 적은 기록 ${count.toLocaleString("ko-KR")}건${nos.length > 0 ? `: ${nos.join(", ")}` : ""} · 자동 반영하지 않은 줄 ${skipped.toLocaleString("ko-KR")}줄`),
        ],
        unknown: false,
      };
    }
    case "WORKBOOK_IMPORT": {
      const legacy = (d.legacy ?? {}) as Record<string, unknown>;
      return {
        lines: [
          text(`${s(d.file)} · 전환일 ${s(d.transitionDate)}`),
          text(`부품 ${n(d.parts)}개 · 처음 수량 줄 ${n(d.openingLines)}개`),
          text(`과거 기록: 확인 ${n(legacy.confirmed)} · 묶음 판정 ${n(legacy.groupDecided)} · 소유 불일치 ${n(legacy.ownerMismatch)} · 못 붙임 ${n(legacy.unmatched)}`),
        ],
        unknown: false,
      };
    }

    /* ── 승인 절차·위임 ────────────────────────────────────────── */
    // 승인 절차(결재선) — 🔴 판 자체가 이력이라 전용 이력 표가 없다. 그러니 이 줄만 읽고도
    // 「누가 누구를 몇 번째에 세웠나」가 보여야 한다(2026-10-12 사용자 지적: JSON 그대로는 안 된다).
    case "APPROVAL_ROUTE_SAVED": {
      // 용도는 「대상」 칸이 한글로 말한다(describeTarget) — 여기서 코드를 또 내보내지 않는다.
      const prev = typeof d.previousVersion === "number" ? `${d.previousVersion}번째 판` : "첫 판";
      return {
        lines: [text(`${prev} → ${s(d.version)}번째 판`), { kind: "field", field: "승인 단계", before: stepNames(d.previousSteps), after: stepNames(d.steps) }],
        unknown: false,
      };
    }
    /**
     * 결재권 위임 (2026-10-21, 조각 3) — 🔴 **이 줄만 읽고도 「누가 누구에게 언제까지 맡겼나」가
     * 보여야 한다.** 표의 줄은 지워지지 않지만 그것을 보는 화면은 본인 것뿐이라, 나중에 「이 건은 왜
     * 본인이 아닌 사람이 눌렀나」를 제3자가 되짚는 자리가 이력이다.
     *
     * 🔵 기간은 **사람이 적었던 날짜 그대로** 적는다 — `endsAt`(다음 날 0시)을 그리면 「26일까지
     *    맡겼네」로 읽힌다(실제로 적은 것은 25일까지다). 그래서 쓰는 쪽이 날짜 두 칸을 함께 남긴다.
     */
    case "APPROVAL_DELEGATION_CREATED": {
      const lines: AuditDetailLine[] = [text(`${s(d.delegateName)} 님에게 ${formatDelegationPeriod(s(d.startDate), s(d.endDate))} 동안 내 결재권을 맡김`)];
      // 사유는 선택이다 — 비면 줄을 그리지 않는다(「없음」을 지어내지 않는다).
      if (d.reason) lines.push(text(`사유: ${s(d.reason)}`));
      return { lines, unknown: false };
    }
    case "APPROVAL_DELEGATION_REVOKED":
      return { lines: [text(`${s(d.delegateName)} 님에게 맡긴 위임(${s(d.endDate)}까지)을 되돌림`)], unknown: false };

    /* ── O/H 템플릿 ────────────────────────────────────────────── */
    // O/H 부품 템플릿 (조각 8a) — 🔴 줄을 통째로 갈아 끼우는 저장이라, **이 줄만 읽고도 그때 무엇이
    // 들어 있었는지** 보여야 한다. 지난 줄을 되찾을 다른 자리가 없다.
    //
    // 🔴 **기종 코드는 2026-10-15 에 없어졌다** — 그날부터 쓰는 쪽이 `code` 를 안 남긴다
    //    (`src/lib/oh/mutations.ts` 의 SAVED·DELETED 둘 다 `name`·`note`·`reason` 만 넣는다).
    //    그런데 읽는 쪽은 「… · 기종 {code} · {이름}」을 그대로 적고 있어, 그 뒤로 쌓인 줄이
    //    **「새 템플릿 · 기종  · 예시 O/H」** 처럼 **빈 「기종 」** 이 끼어 보였다(2026-10-23 쓰는 분 신고).
    // 🔵 **옛 줄은 그대로 보여야 한다.** 2026-10-15 이전에 쌓인 줄에는 `code` 가 들어 있고, 그것은
    //    그때의 사실이다. 그래서 글자를 지우는 것이 아니라 **값이 있을 때만 붙인다**(`ohCodePart`).
    case "OH_TEMPLATE_SAVED": {
      const items = Array.isArray(d.items) ? (d.items as Array<{ displayOrder?: unknown; partNameText?: unknown; quantity?: unknown; linked?: unknown }>) : [];
      const head = d.created ? "새 템플릿" : `${typeof d.previousVersion === "number" ? `${d.previousVersion}번째 판` : "이전 판"} → ${s(d.version)}번째 판`;
      const lines: AuditDetailLine[] = [text([head, ohCodePart(d.code), s(d.name)].filter((p) => p !== "").join(" · "))];
      const previous = (d.previous ?? null) as { code?: unknown; name?: unknown } | null;
      // 머리 칸이 바뀐 것만 앞·뒤로 보여 준다. 안 바뀐 칸까지 줄을 만들면 부품 목록이 묻힌다.
      if (previous && s(previous.code) !== s(d.code)) lines.push({ kind: "field", field: "기종 코드", before: s(previous.code), after: s(d.code) });
      if (previous && s(previous.name) !== s(d.name)) lines.push({ kind: "field", field: "이름", before: s(previous.name), after: s(d.name) });
      lines.push(
        text(
          items.length === 0
            ? "부품 0줄 (비어 있음)"
            : `부품 ${items.length}줄: ${items.map((i) => `${s(i.displayOrder)}. ${s(i.partNameText)} ${s(i.quantity)}개${i.linked ? "" : " (재고 미연결)"}`).join(" · ")}`,
        ),
      );
      return { lines, unknown: false };
    }
    case "OH_TEMPLATE_DELETED":
      return { lines: [{ kind: "text", text: [ohCodePart(d.code), s(d.name)].filter((p) => p !== "").join(" · "), reason: s(d.reason) }], unknown: false };
    case "OH_TEMPLATE_MODEL_LINKED":
    case "OH_TEMPLATE_MODEL_UNLINKED": {
      // 🔴 이름은 **그때 적어 둔 사본**이다. A/S 에서 이름이 바뀌어도 이 줄은 따라 바뀌지 않는다.
      const linked = action === "OH_TEMPLATE_MODEL_LINKED";
      return { lines: [text(`제품 모델 「${s(d.productModelName)}」 ${linked ? "연결" : "연결 해제"}`)], unknown: false };
    }
    case "OH_PRICE_SET": {
      // 🔴 「정하지 않음」과 「0원」을 **다르게** 적는다. 둘을 같은 글자로 보이면 나중에 「왜 견적서에
      // 0원으로 나갔나」를 이력에서 가릴 수 없다(행이 없는 것과 0을 저장한 것은 다른 뜻이다).
      const won = (v: unknown) => (typeof v === "number" ? `₩${v.toLocaleString("ko-KR")}` : "(정하지 않음)");
      return { lines: [{ kind: "field", field: `O/H 단가 ${s(d.partName)}`, before: won(d.before), after: won(d.after) }], unknown: false };
    }
  }

  /**
   * 🔴 **여기로 떨어지면 JSON 그대로다 — 숨기지 않는다.** 새 행위가 생겼는데 위에 분기를 안 더하면
   *    이 길로 오고, 그래야 원인을 찾을 수 있다(2026-10-12 부터의 규칙 그대로).
   * 🔴 다만 **지금 있는 38개는 여기 오면 안 된다** — `tests/audit-detail.test.ts` 가 행위마다 실제
   *    `detail` 모양을 넣어 `unknown === false` 를 전수로 본다. 하나라도 빠지면 그 시험이 깨진다.
   * 🔵 위 `switch` 안의 `break` 둘(부품 수정에 `changes` 가 없는 줄, 수량 기록에 `lines` 가 없는 줄)도
   *    여기로 온다. 모양이 깨진 옛 줄이라 **글자를 지어내는 것보다 날것을 보이는 편이 낫다.**
   */
  return unknownAuditDetail(d);
}
