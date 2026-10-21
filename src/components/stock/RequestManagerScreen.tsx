"use client";

import Link from "next/link";
import { useState } from "react";
import { IssueApprovalTrail } from "./IssueApprovalTrail";
import { RequestActions, type RequestActionLine, type RequestActionStatus } from "./RequestActions";
import type { RequestSource, RequestStatus } from "@/db/schema/stock-requests";
import {
  PART_ISSUE_APPROVALS_LINK_LABEL,
  PART_ISSUE_APPROVALS_PATH,
  PART_ISSUE_LOCK_LABELS,
  PART_ISSUE_LOCK_TITLES,
  partIssueConfirmLabel,
  type PartIssueLock,
} from "@/lib/approval/part-issue-gate";
import type { IssueApprovalTrailView } from "@/lib/approval/part-issue-screen";
import { OWNER_LABEL, formatQuantity, type Owner } from "@/lib/parts/codes";
import {
  ENTRY_TYPE_LABEL,
  REQUEST_SOURCE_LABEL,
  REQUEST_STATUS_FILTER_ORDER,
  canCancelRequest,
  isClaimableRequest,
  requestMatchesStatusFilter,
  requestStatusBadge,
  requestStatusFilterLabel,
  requestStatusLabel,
  type EntryType,
  type RequestStatusFilter,
} from "@/lib/stock/codes";
import { partDetailHref, requestItemDetails, type RequestItemPart } from "@/lib/stock/request-item-detail";
import type { RequestNotice } from "@/lib/stock/request-notice";

/**
 * 부품 요청 관리 `/requests` (관리자는 처리까지, 신청자는 보기만 — 2026-10-15 사용자 결정)
 * — A/S 의 같은 이름 화면(`PartRequestManagerScreen.tsx`)을 옮긴 것
 * (2026-10-15, 조각 10b). **구조가 아니라 모양과 까닭을 옮겼다.**
 *
 * 담당자가 반출 신청을 **한자리에서 훑고 처리하는** 화면이다. **상태를 가리지 않고 전부**(`listAllRequests`)
 * 보고 화면에서 거른다.
 *
 * 🔴 **신청이 보이는 자리는 이 화면 하나다** (2026-10-15 사용자 결정) — 기록 내역(`/entries`) 맨 위의
 *    「확인 대기」 구역은 걷어냈다. 그래서 거기 있던 **[신청 취소]도 여기로 옮겨 왔다**(아래 `canCancelOf`):
 *    옮기지 않으면 신청자가 자기 신청을 거둘 길이 통째로 사라진다.
 *
 * 🔴 옮기면서 **일부러 다르게 한 것 셋**:
 *   1. **낱말은 재고 관리 것**이다. A/S 는 「요청·불출·거절·부분 불출 종료」, 여기는 **「신청·확인·반려·마감」**이다
 *      (화면 제목과 머리말 단추만 사용자가 부르는 대로 「부품 요청 관리」·「부품 요청」).
 *   2. **다크 모드를 뺐다.** 이 저장소에는 다크 모드용 클래스가 한 개도 없다(CLAUDE.md 9-2절: 밝게 고정).
 *      🔵 주석에 그 접두사를 글자 그대로 적지 않는 까닭: Tailwind 는 **주석까지 긁어** 클래스 후보로 읽는다.
 *   3. **표↔카드 전환을 가져오지 않았다.** 원본이 쓰는 `ResponsiveList` 는 A/S 전체가 쓰는 공용 부품이다.
 *      이 저장소의 목록 관례는 **표 + 가로 스크롤**(`PartsList`)이라 그쪽을 따랐다.
 *
 * 🔴 **server-only 를 끌어오지 않는다.** 줄·신청의 모양을 여기 따로 적는 까닭이 그것이다(아래 두 타입).
 *    서버가 내려보내는 `PendingRequestRow`(`src/lib/stock/requests.ts`)는 칸이 더 많고, 더 많은 것은 그냥 버려진다.
 */
export interface ManagerRequestLine extends RequestActionLine, RequestItemPart {
  /** 그 부품의 **지금 재고**. 가용이 남은 수량보다 적으면 지금 다 내줄 수 없다 */
  available: number;
  /** 부품을 못 찾으면 `null` (지워진 부품) */
  owner: Owner | null;
}

export interface ManagerRequestRow {
  id: string;
  type: EntryType;
  status: RequestStatus;
  occurredOn: string;
  intakeNumber: string;
  noRepairCase: boolean;
  counterparty: string;
  reason: string;
  note: string;
  lines: ManagerRequestLine[];
  /** 마감된 신청인가 — 🔴 상태값이 아니라 **세어서** 안다(`isClosedRequest`). 화면은 글자만 「마감」으로 바꾼다 */
  closed: boolean;
  hold: { reason: string; heldByName: string; heldAt: string } | null;
  /** 어디서 올라왔나 (2026-10-15). 신청자 옆의 표식과 [신청 취소]를 그릴지가 여기서 갈린다. */
  source: RequestSource;
  /**
   * 신청한 사람의 id. 🔴 **[신청 취소]를 그릴지 가리는 값**이라 이름이 아니라 id 로 견준다(동명이인).
   * 🔴 A/S 에서 올라왔고 포털 번호로 사람을 못 찾은 신청은 `null` 이다 — 그때도 이름은 있다.
   */
  requestedBy: string | null;
  requestedByName: string;
  requestedAt: string;
}

const BADGE = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";
const TH = "px-3 py-2 font-medium whitespace-nowrap";
const TD = "px-3 py-2 align-top";
/** 돌아온 자리에서 보여 주는 한 줄. 🔵 모양은 기록 내역의 같은 자리와 맞춘다 — 회색은 알림, 주황은 **아직 남은 것이 있다**는 뜻. */
const NOTICE: Record<RequestNotice["tone"], string> = {
  info: "rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700",
  warn: "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900",
};

/**
 * 신청 일시는 짧게 — 목록에서 알아야 하는 것은 「언제쯤」이지 초 단위가 아니다.
 * `toLocaleString` 은 「2026. 10. 15. 오후 12:00:00」(24자)이라 열 하나를 통째로 잡아먹는다.
 *
 * 🔴 **연도는 남긴다**: 반출 신청은 해를 넘겨 남아 있는 것이 있어서, 월·일만 보이면 작년 것과 구별되지 않는다.
 * 🔴 **시간대를 박는다**(CLAUDE.md 10절). 운영 서버(NAS)는 UTC 라 `date.getFullYear()` 꼴로 쓰면 서버가 그린 글자와
 *    브라우저가 그린 글자가 **달라진다**(hydration 이 어긋나고, 날짜가 하루 밀려 보인다).
 * 정확한 값은 `title` 로 붙인다.
 */
const AT_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatRequestedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = AT_PARTS.formatToParts(date);
  const at = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${at("year")}-${at("month")}-${at("day")} ${at("hour")}:${at("minute")}`;
}

function fullAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}

/**
 * 단추를 그릴 수 있는 상태면 그 상태를, 아니면 `null`.
 *
 * 🔴 「대기로 세는 상태」와 「지금 손댈 수 있는 상태」는 다른 묶음이다(codes.ts). 처리 중(CONFIRMING)에 그리면
 *    눌러도 집기에서 거절당하고, 보류는 [보류 해제] 하나만 그린다 — 그 가르기는 `RequestActions` 안에 있다.
 * 🔵 결재 중(`IN_APPROVAL`)도 `null` 이다 — 그 자리에서 할 수 있는 일이 하나도 없다. 대신 **갈 곳은 말해 준다**
 *    (아래 `IssueLockNotice`): 단추를 지우면서 길까지 지우면 막다른 길이 된다.
 */
function actionStatusOf(status: RequestStatus): RequestActionStatus | null {
  if (isClaimableRequest(status)) return status;
  return status === "ON_HOLD" ? "ON_HOLD" : null;
}

/**
 * 단추를 그릴 수 없는 줄에 세우는 **길 안내** (2026-10-21, 조각 11e).
 *
 * 🔴 **그 전에는 `RequestActions` 안의 잠긴 [확인] 자리가 이 말을 했다.** 결재를 올려도 신청이 `PENDING` 이라
 *    단추 묶음이 그려졌고, 거기서 「승인 대기 중」·「실행 대기 중」과 「승인 요청건」 링크가 나왔다. 이제
 *    신청이 `IN_APPROVAL` 로 가면 단추 묶음 자체가 안 그려지므로, **그 말을 잃지 않으려고 여기 옮겨 세운다.**
 * 🔴 둘을 **다른 말로** 보여 주는 까닭은 `part-issue-gate.ts` 의 `PART_ISSUE_LOCK_LABELS` 주석 그대로다 —
 *    「승인 대기」는 결재자를 기다리는 것이고, 「실행 대기」는 **담당자 자신이** 누르면 되는 것이다.
 * 🔵 판정은 서버가 내려보낸 값(`issueLock`)뿐이다. 화면이 다시 세지 않는다.
 */
function IssueLockNotice({ lock }: { lock: PartIssueLock }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 no-print">
      <span className="text-xs text-zinc-500" title={PART_ISSUE_LOCK_TITLES[lock]}>
        {PART_ISSUE_LOCK_LABELS[lock]}
      </span>
      <Link href={PART_ISSUE_APPROVALS_PATH} className="text-xs text-zinc-600 underline hover:text-zinc-900">
        {PART_ISSUE_APPROVALS_LINK_LABEL}
      </Link>
    </span>
  );
}

/** 「무엇에 쓰려는 신청인가」 — 🔵 기록 내역 화면이 그리는 방식과 **같게** 한다. */
function aboutOf(r: ManagerRequestRow): string {
  const head = r.type === "USE" ? (r.noRepairCase ? `수리 건 없음 (${r.reason})` : r.intakeNumber) : r.type === "LOAN" ? `빌려준 곳 ${r.counterparty}` : r.type === "DISPOSE" ? `사유 ${r.reason}` : "";
  return `${head}${r.note ? `${head ? " · " : ""}${r.note}` : ""}`;
}

/**
 * 보류 사유. **담당자 화면에도 보여 준다** — 다른 사람이 멈춰 둔 것을 보고 「왜 멈춰 있는지」를 변경 이력에서
 * 뒤지게 하지 않으려는 것이다(A/S 원본의 `HoldReason` 과 같은 까닭).
 */
function HoldReason({ hold }: { hold: ManagerRequestRow["hold"] }) {
  if (!hold) return null;
  return (
    <div className="max-w-64 rounded-md bg-violet-50 px-2 py-1.5 text-xs">
      <p className="text-violet-900">{hold.reason}</p>
      <p className="mt-0.5 text-violet-700">
        {hold.heldByName} · {formatRequestedAt(hold.heldAt)}
      </p>
    </div>
  );
}

/**
 * 신청 항목 — **이 화면에서 실제로 판단 근거가 되는 자료**다.
 *
 * 머리글을 한 번만 두고 숫자를 열에 세운다. 라벨과 함께 인라인으로 늘어놓으면 항목이 둘 이상일 때 같은 숫자끼리
 * 세로로 맞지 않아, 「남은 게 있는 줄」을 세로로 훑을 수 없다.
 *
 * 🔴 **남음은 화면에서 계산한다**(요청 − 불출). 사람이 뺄셈하게 두면 그 자리가 실수가 나는 자리다.
 * 🔴 **가용이 남음보다 적으면 빨강**: 지금 다 내줄 수 없다는 뜻이고, [확인] 상자를 열거나 상자를 뜯으러 가기
 *    **전에** 보여야 헛걸음을 막는다.
 *
 * 🔵 **자세한 내용을 2026-10-16 에 더했다**(쓰는 분 요청). **열을 늘리지 않고** 품목 칸 안에서 품명 아래
 *    작은 글씨로 묶는다 — 이 표는 이미 `min-w-[64rem]` 에 가로 스크롤이고(이 저장소 관례), 고객사 품명·
 *    품명2·교산 품번·도번을 **열로 세우면 네 열이 늘어** 신청 하나를 보려고 가로로 끌어야 한다. 한편 줄마다
 *    네 토막을 다 적으면 읽을 것이 네 배가 되므로 **값이 있는 칸만** 그린다(`requestItemDetails`).
 * 🔴 **품명을 누르면 부품 상세**로 간다 — 새 화면이 아니라 **이미 있는 길**(`/?part=No.` = 재고 현황의
 *    상세 창)이고, 변경 이력·기록 내역이 쓰는 그 길이다. 🔴 **지워진 부품에는 링크를 걸지 않는다**
 *    (`partDetailHref` 가 `null`). 판정은 화면이 다시 적지 않는다.
 */
function RequestItems({ lines }: { lines: readonly ManagerRequestLine[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-zinc-400">
          <th scope="col" className="pb-1 text-left font-normal">
            품목
          </th>
          <th scope="col" className="w-10 pb-1 text-right font-normal">
            요청
          </th>
          <th scope="col" className="w-10 pb-1 text-right font-normal">
            불출
          </th>
          <th scope="col" className="w-10 pb-1 text-right font-normal">
            남음
          </th>
          <th scope="col" className="w-10 pb-1 text-right font-normal">
            가용
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const issued = Math.min(l.quantity, l.issued);
          const remaining = Math.max(0, l.quantity - l.issued);
          const short = remaining > 0 && l.available < remaining;
          const href = partDetailHref(l.partNo);
          const label = l.partNo !== null ? `No. ${l.partNo} ${l.partName}` : l.partName;
          const details = requestItemDetails(l);
          return (
            <tr key={l.partId} className="border-t border-zinc-100 align-top">
              <td className="py-1 pr-2">
                {/* 🔴 링크는 **번호가 있을 때만**. 지워진 부품은 열 창이 없어 글자 그대로 둔다. */}
                {href ? (
                  <Link href={href} className="text-zinc-800 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500" title="부품 상세 열기">
                    {label}
                  </Link>
                ) : (
                  <span className="text-zinc-800">{label}</span>
                )}
                <span className="block text-zinc-500">{l.owner ? OWNER_LABEL[l.owner] : "-"}</span>
                {/* 🔵 자세한 내용 — 라벨은 더 옅게, 값은 읽히게. 값이 있는 칸만 서고 폭이 모자라면 줄이 접힌다. */}
                {details.length > 0 ? (
                  <span className="mt-0.5 block text-[11px] leading-snug text-zinc-600">
                    {details.map((d, i) => (
                      <span key={d.label}>
                        {i > 0 ? <span className="text-zinc-300"> · </span> : null}
                        <span className="text-zinc-400">{d.label} </span>
                        {d.value}
                      </span>
                    ))}
                  </span>
                ) : null}
              </td>
              <td className="tabular py-1 text-right text-zinc-700">{formatQuantity(l.quantity)}</td>
              <td className={`tabular py-1 text-right ${issued > 0 ? "text-zinc-700" : "text-zinc-300"}`}>{formatQuantity(issued)}</td>
              <td className={`tabular py-1 text-right ${remaining > 0 ? "font-medium text-amber-700" : "text-zinc-300"}`}>{formatQuantity(remaining)}</td>
              <td className={`tabular py-1 text-right ${short ? "font-medium text-red-700" : "text-zinc-500"}`} title={short ? "지금 재고로는 남은 수량을 다 내줄 수 없습니다." : undefined}>
                {formatQuantity(l.available)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * @param isAdmin 확인·반려·마감·보류 단추를 그릴지 (2026-10-15 사용자 결정: 신청자는 **보고 거두기만** 한다).
 * @param currentUserId 지금 보는 사람. **본인이 낸 대기 신청**에만 [신청 취소]를 그리려고 받는다 (2026-10-15).
 *
 * 🔴 **둘 다 울타리가 아니다.** 단추를 안 그리는 것은 편의일 뿐이고, 막는 자리는 단추가 부르는 서버 액션이다
 *    (`src/app/actions/stock.ts`): 확인·반려·마감·보류·보류 해제는 `requireRole("ADMIN", …)` 이고,
 *    **[신청 취소]는 `requireRole("STAFF", …)` 에 더해 `cancelRequest` 의 WHERE 가
 *    「본인이 낸, 아직 PENDING 인 것」만** 받는다(`src/lib/stock/requests.ts`). 여기를 고쳐 불러도 남의 신청은
 *    거둬지지 않는다. 화면 조건을 「막는 자리」로 읽지 않게 적어 둔다.
 *
 * @param approvalRequired 「부품 불출」 승인 절차가 **지금 쓰이고 있는가** (2026-10-15, 조각 11c).
 * @param issueLocks 살아 있는 결재건이 붙들고 있는 신청 → 그 까닭. **잠긴 신청만 들어 있다.**
 * @param issueTrails 그 결재건의 **진행 그림**(2026-10-21, 조각 11f). 역시 **결재가 걸린 신청만** 들어 있다.
 *   🔵 `issueLocks` 와 **같은 묶음**에서 나온다(살아 있는 결재건) — 한쪽에만 있는 줄은 생기지 않는다.
 *
 * 🔴 **이 셋은 서버가 판정해 내려보낸 값이다**(`src/app/(app)/requests/page.tsx`). 화면이 다시 판정하지
 *    않는다 — 두 벌이 되면 「단추는 보이는데 누르면 거절」이나 그 반대가 되고, 후자는 화면에 아무 표시도
 *    남기지 않아 더 나쁘다(A/S 원본 `PartRequestManagerScreen` 의 까닭 그대로).
 */
export function RequestManagerScreen({
  requests,
  notices,
  isAdmin,
  currentUserId,
  approvalRequired,
  issueLocks,
  issueTrails,
}: {
  requests: ManagerRequestRow[];
  notices: RequestNotice[];
  isAdmin: boolean;
  currentUserId: string;
  approvalRequired: boolean;
  issueLocks: Record<string, PartIssueLock>;
  issueTrails: Record<string, IssueApprovalTrailView>;
}) {
  /**
   * 🔵 거르기는 **화면에서** 한다(A/S 원본과 같고, 이 저장소의 `PartsList` 관례와도 같다) — 목록이 한 번에 다 와 있다.
   * 🔴 **거르개 값이 더 이상 상태 하나가 아니다** (2026-10-21) — 「실행 대기」가 한 칸 더 선다. 가르는 규칙은
   *    화면에 적지 않고 순수 함수 한 곳에 둔다(`requestMatchesStatusFilter`): 이 저장소에는 화면 렌더 시험이
   *    없어서, 여기 적은 조건은 아무도 돌려 보지 못한 채 운영으로 나간다.
   */
  const [statusFilter, setStatusFilter] = useState<RequestStatusFilter>("ALL");
  const filtered = requests.filter((r) => requestMatchesStatusFilter(statusFilter, { status: r.status, issueLock: issueLocks[r.id] ?? null }));
  /**
   * 내가 거둘 수 있는 줄인가 — **본인이 낸, 아직 대기(PENDING)인 것**.
   * 🔴 기록 내역에 있던 조건 그대로다(`r.status === "PENDING" && r.requestedBy === 내 id`). 부품이 한 개라도
   *    나간 뒤에는(PARTIAL) 거둘 수 없고, 보류 중이면 담당자가 먼저 풀어야 한다 — 서버의 WHERE 와 같은 말이다.
   * 🔵 관리자도 **자기가 낸 요청**이면 이 단추를 본다. 2026-10-15 부터는 관리자가 적은 반출도 요청으로 올라간다.
   * 🔴 **A/S 에서 올라온 신청에는 안 그린다** — 거두는 것은 낸 쪽의 몫이다. 판정은 화면이 다시 적지 않고
   *    서버와 **같은 한 벌**(`canCancelRequest`, `codes.ts`)을 쓴다.
   */
  const canCancelOf = (r: ManagerRequestRow) => canCancelRequest(r, currentUserId);
  /**
   * 단추 열을 그릴지. 🔴 **「관리자면」이 아니다** — 신청자도 자기 대기 신청을 거두므로, 거둘 수 있는 줄이
   *    하나라도 보이면 그 열이 필요하다. 지금 **보이는 목록**(`filtered`)으로 재는 까닭: 열이 거르개를 따라가야
   *    빈 열이 남지 않는다.
   */
  const showActions = isAdmin || filtered.some(canCancelOf);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-zinc-900">부품 요청 관리</h1>
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          상태
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RequestStatusFilter)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900"
            aria-label="상태로 거르기"
          >
            <option value="ALL">전체 상태</option>
            {/* 🔵 고르개에 보이는 글자는 [상태] 칸의 글자와 **같은 한 벌**에서 온다 — 다르면 사람이 같은 것인 줄 모른다. */}
            {REQUEST_STATUS_FILTER_ORDER.map((s) => (
              <option key={s} value={s}>
                {requestStatusFilterLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <span className="tabular ml-auto text-xs text-zinc-500">{filtered.length}건</span>
      </div>

      {/* 🔵 안내도 갈린다 — 신청자에게 없는 단추의 쓰는 법을 적어 두면 거짓이 된다 (2026-10-15). */}
      {isAdmin ? (
        <p className="text-xs text-zinc-500">
          올라온 반출 신청을 전부 봅니다(최신이 위). <b>[{partIssueConfirmLabel(approvalRequired)}]</b>에서 줄별로 이번에 내줄 수량을 정하고, 더 줄 것이 없으면 <b>[마감]</b>으로 닫습니다. 지금 처리하지
          않을 것은 <b>[보류]</b>로 사유를 적어 멈춰 둡니다 — 보류한 신청은 목록에 그대로 남고 머리말의 「대기」 숫자에서만 빠집니다.
          {/* 🔴 절차가 쓰이고 있으면 **그 자리에서 재고가 빠지지 않는다** — 단추 이름만 바뀌면 사람은 눌러 보고 나서야 안다. */}
          {approvalRequired ? <> 지금은 부품 불출 승인 절차가 있어 <b>[불출 신청]</b>이 결재를 올리고, 결재가 끝난 뒤 「승인 요청건」 화면에서 실행합니다.</> : null}
        </p>
      ) : (
        <p className="text-xs text-zinc-500">
          올라온 반출 신청을 전부 봅니다(최신이 위). 확인·반려·마감·보류는 담당자(관리자)가 합니다. 내가 낸 신청이 아직 <b>「대기」</b>일 때는 <b>[신청 취소]</b>로 거둘 수 있습니다 — 한 개라도 나간
          뒤에는 거둘 수 없습니다.
        </p>
      )}

      {/* 방금 누른 단추의 결과 (2026-10-15, 조각 10c). 🔵 글자는 기록 내역과 같은 한 벌에서 온다(`request-notice.ts`). */}
      {notices.map((n) => (
        <p key={n.text} className={NOTICE[n.tone]}>
          {n.text}
        </p>
      ))}

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">해당하는 요청이 없습니다.</p>
      ) : (
        <section className="rounded-lg border border-zinc-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-xs text-zinc-500">
                  <th scope="col" className={TH}>
                    신청 일시
                  </th>
                  <th scope="col" className={TH}>
                    종류
                  </th>
                  <th scope="col" className={TH}>
                    무엇에
                  </th>
                  <th scope="col" className={TH}>
                    신청자
                  </th>
                  {/* 이 열이 판단 근거다 — 폭을 넉넉히 준다. */}
                  <th scope="col" className={`${TH} w-[24rem]`}>
                    신청 항목
                  </th>
                  <th scope="col" className={TH}>
                    상태
                  </th>
                  {/* 🔵 단추 열은 그릴 단추가 있을 때만 — 아니면 「처리할 것 없음」만 줄줄이 선 빈 열이 된다(위 `showActions`). */}
                  {showActions ? <th scope="col" className={`${TH} no-print`} /> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const actionStatus = actionStatusOf(r.status);
                  const canCancel = canCancelOf(r);
                  // 🔵 둘 다 **잠긴 신청에만** 들어 있다(서버가 같은 묶음에서 만든다). 없으면 이 줄은 지금까지와 한 글자도 다르지 않다.
                  const issueLock = issueLocks[r.id] ?? null;
                  const issueTrail = issueTrails[r.id];
                  return (
                    <tr key={r.id} className="border-t border-zinc-200 align-top hover:bg-zinc-50">
                      <td title={fullAt(r.requestedAt)} className={`${TD} tabular text-xs whitespace-nowrap text-zinc-600`}>
                        {formatRequestedAt(r.requestedAt)}
                      </td>
                      <td className={`${TD} whitespace-nowrap text-zinc-700`}>
                        {ENTRY_TYPE_LABEL[r.type]}
                        <span className="tabular block text-xs text-zinc-500">{r.occurredOn}</span>
                      </td>
                      <td className={`${TD} max-w-64 text-zinc-700`}>{aboutOf(r) || <span className="text-zinc-400">-</span>}</td>
                      {/* 🔵 다른 데서 올라온 신청에만 표식을 붙인다 — 거의 전부가 재고 관리에서 직접 올린 것이라,
                          줄마다 출처가 붙으면 눈에 띄어야 할 「A/S」가 묻힌다(`REQUEST_SOURCE_LABEL`). */}
                      <td className={`${TD} whitespace-nowrap text-zinc-700`}>
                        {r.requestedByName}
                        {REQUEST_SOURCE_LABEL[r.source] ? <span className={`${BADGE} ml-1 bg-zinc-100 text-zinc-600`}>{REQUEST_SOURCE_LABEL[r.source]}</span> : null}
                      </td>
                      <td className={`${TD} w-[24rem]`}>
                        <RequestItems lines={r.lines} />
                      </td>
                      <td className={TD}>
                        <div className="flex flex-col gap-1">
                          {/* 🔴 마감된 신청은 「확인됨」이 아니라 「마감」, 결재가 끝나 실행만 남았으면 「결재 중」이 아니라 「실행 대기」다.
                              가르는 자리는 화면이 아니라 `codes.ts` 의 그 한 곳이고, 여기서는 **받은 값을 넘기기만** 한다. */}
                          <span className={`${BADGE} ${requestStatusBadge(r.status, r.closed, issueLock)}`}>{requestStatusLabel(r.status, r.closed, issueLock)}</span>
                          {/* 🔵 결재가 걸린 줄에만 그린다 — 결재가 없는 줄에는 그릴 것이 없고, 전체 신청 목록이라 모든 줄에 그리면 표가 길어진다.
                              🔵 폭을 묶어 둔다: 상자가 늘어나도 **이 칸 안에서만** 밀린다(그림 자신이 가로 스크롤을 들고 있다). */}
                          {issueTrail ? (
                            <div className="mt-0.5 max-w-72">
                              <IssueApprovalTrail status={issueTrail.status} currentStep={issueTrail.currentStep} steps={issueTrail.steps} />
                            </div>
                          ) : null}
                          <HoldReason hold={r.hold} />
                        </div>
                      </td>
                      {showActions ? (
                        <td className={`${TD} no-print`}>
                          {/* 🔴 그릴 것이 **하나라도** 있을 때만 단추 묶음을 쓴다 — 관리자가 아니고 내 대기 신청도 아니면
                              `RequestActions` 는 빈 상자만 그린다. 「처리할 것 없음」은 처리하는 사람(관리자)에게만 뜻이 있는 말이라
                              신청자에게는 빈 칸으로 둔다. */}
                          {actionStatus !== null && (isAdmin || canCancel) ? (
                            /* 🔵 잠금은 **잠긴 신청만** 내려온다 — 없으면 `null` 이고 그때 [확인] 자리는 지금까지 그대로다. */
                            <RequestActions
                              requestId={r.id}
                              status={actionStatus}
                              lines={r.lines}
                              canDecide={isAdmin}
                              canCancel={canCancel}
                              approvalRequired={approvalRequired}
                              issueLock={issueLock}
                            />
                          ) : issueLock ? (
                            /* 🔵 결재가 그 신청을 붙들고 있으면 단추는 없어도 **갈 곳은 말해 준다**(위 `IssueLockNotice`). */
                            <IssueLockNotice lock={issueLock} />
                          ) : isAdmin ? (
                            <span className="text-xs text-zinc-400">처리할 것 없음</span>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
