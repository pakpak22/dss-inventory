"use client";

import { useActionState, useState, type ReactNode } from "react";
import { createDelegationAction, revokeDelegationAction, type DelegationActionState } from "@/app/actions/approval-delegations";
import {
  delegationCreatorLabel,
  delegationFinishedTruncatedNotice,
  delegationStateBadge,
  formatDelegationPeriod,
  DELEGATION_DIRECTORY_UNREACHABLE_SUFFIX,
  DELEGATION_NOTHING_ACTING,
  DELEGATION_NOTHING_FINISHED_ALL,
  DELEGATION_NOTHING_I_MADE,
  DELEGATION_NOTHING_LIVE_ALL,
  type AllDelegationRowView,
  type AllDelegationsView,
  type DelegationNotice,
  type DelegationRowView,
} from "@/lib/approval/delegation-screen";
import { DELEGATION_REASON_MAX } from "@/lib/approval/delegation-input";
import { asUserChoiceLabel, AS_DIRECTORY_MESSAGES, type AsUserChoiceDirectory } from "@/lib/approval/directory";

/**
 * ============================================================================
 * 결재권 위임 — 설정의 탭 `/settings/delegations` (2026-10-21, 조각 3)
 * ============================================================================
 * 결재권자가 출장·휴가로 자리를 비우면 그 건이 **선다.** 그 자리를 메우는 길을 여는 화면이다.
 *
 * ── 🔵 자리를 한 번 옮겼다 ─────────────────────────────────────────────
 * 처음에는 「승인 요청건」(`/approvals`) 안의 구역이었다 — 결재자가 이미 가는 화면이라서다.
 * 2026-10-21 사용자 요청으로 **설정의 탭**으로 옮겼고, 못 찾는 일이 없도록 `/approvals` 에는
 * **한 줄 링크**를 남겼다. 🔴 그 탭의 문은 `requireSession` 이다 — 설정의 다른 탭처럼
 * `requireRole("ADMIN")` 으로 막으면 결재선에 든 보기 권한자가 자기 위임을 영영 못 만든다.
 *
 * ── 🔴 묶음 넷 ─────────────────────────────────────────────────────────
 *  (가) **새 위임 만들기** — **누구의 결재권**(관리자만) · 누구에게 · 기간 · 사유(선택)
 *  (나) **내가 맡긴 것** — 살아 있음/시작 전/끝남/되돌림이 **갈려 보이고**, 되돌릴 수 있는 것에 단추
 *  (다) **내가 대신하고 있는 것**(읽기 전용) — 🔴 **이것이 없으면 대리인은 「왜 이 건이 내 결재
 *       목록에 떴는지」를 알 수 없다.** 결재건 카드에는 결재선의 **원래 사람** 이름이 적혀 있어
 *       자기 이름이 없는 건이 자기 목록에 뜬다. 까닭이 적힌 곳이 이 묶음뿐이다.
 *  (라) **모두의 결재권 위임**(2026-10-26, 관리 권한이 있을 때만)
 *
 * ── 🔴 2026-10-26: 관리자가 **남의 결재권도** 맡긴다 ────────────────────
 * 자리를 갑자기 비우게 된 사람(병가·사고)은 본인이 설정할 수 없어서 넓혔다(사용자 결정).
 * 화면에서 권한이 여닫는 것은 **둘**이다 — 「누구의 결재권」 고르개와 (라) 묶음.
 *
 * 🔴 **(라)가 없으면 관리자가 방금 세운 줄이 제 화면 어디에도 안 뜬다.** (나)·(다)는 「내가
 * 결재권자」 또는 「내가 대리인」인 줄만 담는데 세운 사람은 둘 다 아니다 — 저장이 안 된 것처럼
 * 보이고, 되돌릴 권한이 있는데도 그 줄을 집을 길이 없다. A/S 에서 실제로 겪은 일이다.
 * 🔴 **그 묶음의 자료는 권한이 없으면 아예 안 내려온다**(`all === null`). 화면이 가리는 것이
 * 아니라 **없는 것**이고, 판정은 조회 함수가 제 손으로 한다 — 그래서 이 파일에 권한 판정이
 * 한 줄도 없다.
 *
 * ── 🔴 화면에 **포털 번호가 내려오지 않는다** ──────────────────────────
 * 고르개가 보내는 것은 **A/S 사용자 id** 이고, 번호로 푸는 일은 서버가 명부를 보고 한다
 * (`src/lib/approval/delegation-mutations.ts`). 번호는 신원 증명에 쓰이는 값이라 화면이 받는
 * 어느 타입에도 담을 칸이 없다.
 *
 * 🔴 **「못 받아 왔다」를 「없다」로 그리지 않는다** — A/S 가 꺼져 있으면 고르개를 잠그고 그
 * 사실을 말하되, 아래 두 목록은 저장된 내용 그대로 보여 준다(`ApprovalRouteSection` 과 같은 판단).
 * 🔴 **판정을 새로 적지 않는다** — 「되돌릴 수 있나」·배지 글자·기간 글자는 전부 순수 모듈
 * (`@/lib/approval/delegation-screen`)에서 온다. 여기 손으로 적으면 아무도 돌려 보지 못한다.
 * ============================================================================
 */

const BADGE = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";
const BTN = "rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";
const BTN_P = "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50";
const FIELD = "rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500";
const EMPTY_BOX = "rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500";
const EMPTY_STATE: DelegationActionState = { error: null };

/**
 * 위임 한 줄 — 상대방·기간·상태·사유, 그리고 (내가 맡긴 것에만) [되돌리기].
 *
 * 🔴 **「되돌릴 수 있나」를 여기서 다시 판정하지 않는다.** 서버가 `canRevoke` 로 실어 보낸 것을
 * 부르는 쪽이 보고 단추를 넘긴다 — 화면이 `canRevokeDelegation` 을 또 부르면 서버 판정과 두 벌이
 * 되고, 그때 어긋남은 「보이는데 눌러도 거절당하는 단추」로 나타난다.
 */
function DelegationRow({ row, lead, action }: { row: DelegationRowView; lead: string; action: ReactNode }) {
  const badge = delegationStateBadge(row.state);
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-zinc-900">
            <b>{row.counterpartName}</b> 님{lead}
          </span>
          <span className="tabular text-[11px] text-zinc-500">{formatDelegationPeriod(row.startDate, row.endDate)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 🔴 색과 글자를 **함께** 그린다 — 색만으로 상태를 구분하지 않는다(CLAUDE.md 9-7절). */}
          <span className={`${BADGE} ${badge.className}`}>{badge.label}</span>
          {action}
        </div>
      </div>
      {/* 🔵 사유는 선택이라 비어 있을 수 있다. 비면 **이 줄을 아예 그리지 않는다** — 「없음」을 지어내지 않는다. */}
      {row.reason ? <p className="rounded-md bg-zinc-50 px-2 py-1 text-xs break-keep text-zinc-700">사유: {row.reason}</p> : null}
      {/* 🔴 되돌린 줄에는 **누가 거뒀는지**를 적는다. 2026-10-26 부터 관리자도 남의 위임을
          거둘 수 있어, 이 줄이 없으면 「내가 맡긴 것」에서 **내가 거두지 않은 되돌림**이
          까닭 없이 나타난다. */}
      {row.revokedByName ? <p className="text-[11px] text-zinc-500">{row.revokedByName} 님이 되돌렸습니다.</p> : null}
    </li>
  );
}

/**
 * 모두의 목록 한 줄 — **두 이름을 다 적는다.** 🔴 위 `DelegationRow` 를 돌려쓰지 않는 까닭:
 * 저쪽은 「상대방」 한 칸이고 나머지 한쪽이 **언제나 보는 사람 자신**이라는 전제가 있다. 여기는
 * 보는 사람이 양쪽 다 아닐 수 있어, 그 전제를 끌고 오면 「누가 누구에게」가 사라진다.
 */
function AllDelegationRow({ row, action }: { row: AllDelegationRowView; action: ReactNode }) {
  const badge = delegationStateBadge(row.state);
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-zinc-900">
            <b>{row.delegatorName}</b> 님 → <b>{row.delegateName}</b> 님
          </span>
          <span className="tabular text-[11px] text-zinc-500">{formatDelegationPeriod(row.startDate, row.endDate)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${BADGE} ${badge.className}`}>{badge.label}</span>
          {action}
        </div>
      </div>
      {/* 🔴 「본인이 맡겼나, 관리자가 세웠나」 — 이름만 적으면 이 칸을 둔 까닭이 화면에서 사라진다. */}
      <p className="text-[11px] text-zinc-500">지정: {delegationCreatorLabel(row)}</p>
      {row.reason ? <p className="rounded-md bg-zinc-50 px-2 py-1 text-xs break-keep text-zinc-700">사유: {row.reason}</p> : null}
      {row.revokedByName ? <p className="text-[11px] text-zinc-500">{row.revokedByName} 님이 되돌렸습니다.</p> : null}
    </li>
  );
}

export function DelegationSection({
  directory,
  made,
  acting,
  all,
  canDelegateForOthers,
  meName,
  today,
  notice,
}: {
  /** 🔴 포털 번호가 빠진 명부. 못 받아 왔을 수 있고, 그것은 「한 명도 없다」와 다른 말이다. */
  directory: AsUserChoiceDirectory;
  made: DelegationRowView[];
  acting: DelegationRowView[];
  /**
   * 🔴 **모두의 줄. `null` 이면 묶음을 아예 그리지 않는다** — 감추는 것이 아니라 없는 것이다.
   * 🔴 **화면이 판정해서 `null` 이 되는 것이 아니다**(머리말) — 조회가 거절한 것을 서버
   *    컴포넌트가 옮겨 적었을 뿐이다.
   */
  all: AllDelegationsView | null;
  /**
   * 🔴 「**남의** 결재권까지 맡길 수 있는가」 — 서버가 셈해 내려보낸다(여기는 클라이언트라
   * 역할표를 다시 묻지 못한다). 🔵 **울타리가 아니다**: 쓰는 층이 같은 자로 다시 판정하므로
   * 이 값은 **고르개를 그릴지**만 정한다.
   */
  canDelegateForOthers: boolean;
  /** 🔵 고르개를 안 그릴 때 그 자리에 적는 **내 이름**. 잠긴 고르개를 두지 않기 때문에 필요하다. */
  meName: string;
  /** 오늘(한국). 🔵 시작일 기본값으로만 쓴다 — 서버가 정해 내려보낸다(자정 즈음에 갈리지 않게). */
  today: string;
  notice: DelegationNotice | null;
}) {
  const [createState, create, creating] = useActionState<DelegationActionState, FormData>(createDelegationAction, EMPTY_STATE);
  const [revokeState, revoke, revoking] = useActionState<DelegationActionState, FormData>(revokeDelegationAction, EMPTY_STATE);
  /**
   * 🔵 접어 둔다 — 위임은 어쩌다 한 번 하는 일이라, 늘 펴 두면 **이미 맡긴 것·대신하는 것** 두
   *    목록이 그만큼 아래로 밀린다. 이 화면에 오는 사람은 새로 맡기러 오기도 하지만 「내가 뭘
   *    맡겨 뒀더라」를 보러 오기도 한다.
   */
  const [open, setOpen] = useState(false);
  /**
   * 🔵 **끝난 줄은 접어 둔다** — 쌓이기만 하고(줄을 지우는 길이 없다) 할 수 있는 일도 없다.
   *    조회가 상한까지 걸어 두므로 펼쳐도 끝없이 길어지지 않는다.
   */
  const [showFinished, setShowFinished] = useState(false);

  const busy = creating || revoking;
  const candidates = directory.status === "ok" ? directory.users : [];

  return (
    /* 🔵 위쪽 구분선을 걷어냈다 — 결재 목록 **아래**에 이어 붙던 때의 것이고, 이제는 자기 화면의
       맨 위다. 두면 바로 위 `SettingsNav` 의 아랫줄과 **두 줄이 겹쳐** 보인다. */
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">결재권 위임</h2>
        <button type="button" className={BTN} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "닫기" : "결재권 맡기기"}
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        출장·휴가로 자리를 비우는 동안 <b>내 결재 차례를 다른 분이 대신</b> 누를 수 있게 합니다. 승인 절차(결재선)는 바뀌지 않고,
        그 기간에 누를 수 있는 사람만 늘어납니다 — <b>내가 직접 누르는 길은 그대로 열려 있습니다.</b>
      </p>

      {notice ? <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{notice.text}</p> : null}

      {/* (가) 새 위임 만들기 */}
      {open && (
        <form action={create} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3">
          {/* 🔴 명부를 못 받아 왔을 때. **「없습니다」라고 말하지 않는다** — 아래 목록은 저장된 내용 그대로다. */}
          {directory.status !== "ok" && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              {AS_DIRECTORY_MESSAGES[directory.reason]} {DELEGATION_DIRECTORY_UNREACHABLE_SUFFIX}
            </p>
          )}

          {/* 🔴 「누구의 결재권인가」 — 관리 권한이 **있을 때만 고르개를 그린다**(2026-10-26).
              권한이 없으면 고르개를 **아예 그리지 않는다**: 잠긴 고르개를 두면 남의 이름이
              목록에 실려 나가고, 고를 수 없는 까닭도 그 자리에 보이지 않는다. */}
          {canDelegateForOthers ? (
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              누구의 결재권
              {/* 🔴 첫 줄이 **언제나 본인**이고 기본값이다. 가장 흔한 쓰임이 자기 자리를 맡기는
                  것이고, 남의 이름이 먼저 떠 있으면 그대로 저장해 **엉뚱한 사람의 결재권**이
                  넘어간다. 🔵 값이 빈 글자인 까닭: 세션에는 포털 번호만 있고 **그 사람의 A/S
                  번호는 모른다** — 서버는 빈 값을 본인으로 읽는다(`delegation-input.ts`). */}
              <select name="delegatorUserId" disabled={busy} className={FIELD} defaultValue="">
                <option value="">{meName} 님 (본인)</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id} disabled={!candidate.selectable}>
                    {asUserChoiceLabel(candidate)}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-zinc-500">
                본인이 아닌 분을 고르면 <b>관리자가 대신 세운 위임</b>으로 기록됩니다.
              </span>
            </label>
          ) : (
            /* 🔵 고르개가 없는 사람에게도 **누구의 결재권인지는 말해 준다** — 적지 않으면
               「내 것이 맡겨지는 게 맞나」를 화면에서 확인할 길이 없다. 폼에 칸이 없으므로
               서버로는 아무 값도 가지 않고, 서버가 세션의 번호를 쓴다. */
            <p className="text-xs text-zinc-500">
              누구의 결재권: <b className="text-zinc-900">{meName} 님 (본인)</b>
            </p>
          )}

          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            대신할 분 *
            <select name="delegateUserId" required disabled={busy || directory.status !== "ok"} className={FIELD} defaultValue="">
              <option value="" disabled>
                선택하세요
              </option>
              {/* 🔴 통합 로그인 기록이 없는 분은 **잠그되 목록에 둔다** — 빼 버리면 「왜 저 사람이 없지」가
                  되고, 잠가 두면 까닭이 그 자리에 보인다(`ApprovalRouteSection` 과 같은 관례). */}
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id} disabled={!candidate.selectable}>
                  {asUserChoiceLabel(candidate)}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              시작일 *
              <input type="date" name="startDate" required defaultValue={today} disabled={busy} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              종료일 *
              <input type="date" name="endDate" required disabled={busy} className={FIELD} />
            </label>
          </div>
          {/* 🔴 사람이 적는 「~까지」가 그날 **하루 전체**를 덮는다는 것을 말해 둔다. 서버가 종료일을
              「그 다음 날 0시」로 바꿔 넣기 때문인데, 그 셈을 모르는 사람은 하루를 더 적는다. */}
          <p className="text-[11px] text-zinc-500">종료일 <b>당일까지</b> 포함됩니다. 시작일과 종료일을 같은 날로 두면 그 하루만 맡깁니다.</p>

          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            사유 (선택)
            <input name="reason" maxLength={DELEGATION_REASON_MAX} disabled={busy} className={FIELD} placeholder="예: 10/25까지 출장" />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={BTN_P} disabled={busy || directory.status !== "ok"}>
              {creating ? "맡기는 중" : "맡기기"}
            </button>
            {/* 🔴 서버가 돌려준 문구 **그대로**. 뭉개지 않는다. */}
            {createState.error ? <p className="text-xs text-red-600">{createState.error}</p> : null}
          </div>
        </form>
      )}

      {/* (나) 내가 맡긴 것 — 🔴 지난 줄을 감추지 않는다. 「분명 맡겼는데 흔적이 없다」가 되지 않게. */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-zinc-700">
          내가 맡긴 것 <span className="tabular text-zinc-500">{made.length}건</span>
        </h3>
        {made.length === 0 ? (
          <p className={EMPTY_BOX}>{DELEGATION_NOTHING_I_MADE}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {made.map((row) => (
              <DelegationRow
                key={row.id}
                row={row}
                lead="에게 맡김"
                action={
                  /* 🔵 울타리가 아니라 「그릴까」다 — 막는 자리는 되돌리기 조건절의 `delegator_sub = 내 번호` 다. */
                  row.canRevoke ? (
                    <form action={revoke}>
                      <input type="hidden" name="delegationId" value={row.id} />
                      <button type="submit" className={BTN} disabled={busy}>
                        {revoking ? "되돌리는 중" : "되돌리기"}
                      </button>
                    </form>
                  ) : null
                }
              />
            ))}
          </ul>
        )}
        {revokeState.error ? <p className="text-xs text-red-600">{revokeState.error}</p> : null}
      </div>

      {/* (다) 내가 대신하고 있는 것 — 읽기 전용. 🔴 남의 건이 내 목록에 뜬 까닭이 적히는 유일한 자리다. */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-zinc-700">
          내가 대신하고 있는 것 <span className="tabular text-zinc-500">{acting.length}건</span>
        </h3>
        {acting.length === 0 ? (
          <p className={EMPTY_BOX}>{DELEGATION_NOTHING_ACTING}</p>
        ) : (
          <>
            <p className="text-[11px] text-zinc-500">
              아래 분들의 결재 차례가 <b>내가 결재할 건</b>에 함께 보입니다. 그 건의 결재선에는 원래 그분 이름이 적혀 있습니다.
            </p>
            <ul className="flex flex-col gap-2">
              {acting.map((row) => (
                /* 🔵 **대리인은 제가 맡은 위임을 거둘 수 없다** — 여기서는 단추를 내밀지 않는다.
                   맡은 사람이 스스로 자격을 버리면 맡긴 사람이 모르는 사이에 그 차례가 다시 선다.
                   🔵 관리자라면 아래 (라) 묶음에서 거둔다 — 그것은 **제 역할로** 거두는 것이다. */
                <DelegationRow key={row.id} row={row} lead="의 결재권을 대신하는 중" action={null} />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* (라) 모두의 결재권 위임 — 🔴 자료가 없으면 이 묶음은 **없다**(머리말). */}
      {all && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4">
          <h3 className="text-xs font-medium text-zinc-700">
            모두의 결재권 위임 <span className="tabular text-zinc-500">{all.live.length}건</span>
          </h3>
          {/* 🔵 위의 두 묶음과 **겹치는 줄이 있다.** 걸러 내면 「전부 보인다」가 거짓이 되고
              사람은 빠진 줄을 찾느라 헤맨다 — 겹친다는 사실을 적어 두는 쪽을 골랐다. */}
          <p className="text-[11px] text-zinc-500">
            관리 권한이 있어 <b>모든 분의 결재권 위임</b>을 봅니다. 위의 두 묶음에 뜬 줄도 여기에 다시 보입니다.
          </p>

          {all.live.length === 0 ? (
            <p className={EMPTY_BOX}>{DELEGATION_NOTHING_LIVE_ALL}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {all.live.map((row) => (
                <AllDelegationRow
                  key={row.id}
                  row={row}
                  action={
                    row.canRevoke ? (
                      <form action={revoke}>
                        <input type="hidden" name="delegationId" value={row.id} />
                        <button type="submit" className={BTN} disabled={busy}>
                          {revoking ? "되돌리는 중" : "되돌리기"}
                        </button>
                      </form>
                    ) : null
                  }
                />
              ))}
            </ul>
          )}

          <div>
            <button type="button" className={BTN} onClick={() => setShowFinished((v) => !v)} aria-expanded={showFinished}>
              {showFinished ? "끝난 위임 접기" : `끝난 위임 보기 (${all.finished.length}건${all.finishedTruncated ? "+" : ""})`}
            </button>
          </div>

          {showFinished && (
            <div className="flex flex-col gap-2">
              {/* 🔴 **잘렸다는 것을 반드시 말해 준다.** 말하지 않으면 「이게 전부」로 읽히고,
                  없는 줄을 찾는 사람이 변경 이력까지 가야 한다는 것도 모른다. */}
              {all.finishedTruncated ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                  {delegationFinishedTruncatedNotice(all.finishedLimit)}
                </p>
              ) : null}
              {all.finished.length === 0 ? (
                <p className={EMPTY_BOX}>{DELEGATION_NOTHING_FINISHED_ALL}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {all.finished.map((row) => (
                    /* 🔵 끝난 줄에는 단추가 없다 — 서버도 거절한다(`canRevoke` 가 거짓이다). */
                    <AllDelegationRow key={row.id} row={row} action={null} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
