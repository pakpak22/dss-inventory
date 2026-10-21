"use client";

import { useActionState, useState, type ReactNode } from "react";
import { createDelegationAction, revokeDelegationAction, type DelegationActionState } from "@/app/actions/approval-delegations";
import {
  delegationStateBadge,
  formatDelegationPeriod,
  DELEGATION_DIRECTORY_UNREACHABLE_SUFFIX,
  DELEGATION_NOTHING_ACTING,
  DELEGATION_NOTHING_I_MADE,
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
 * ── 🔴 묶음 셋 ─────────────────────────────────────────────────────────
 *  (가) **새 위임 만들기** — 누구에게 · 언제부터 언제까지 · 사유(선택)
 *  (나) **내가 맡긴 것** — 살아 있음/시작 전/끝남/되돌림이 **갈려 보이고**, 되돌릴 수 있는 것에 단추
 *  (다) **내가 대신하고 있는 것**(읽기 전용) — 🔴 **이것이 없으면 대리인은 「왜 이 건이 내 결재
 *       목록에 떴는지」를 알 수 없다.** 결재건 카드에는 결재선의 **원래 사람** 이름이 적혀 있어
 *       자기 이름이 없는 건이 자기 목록에 뜬다. 까닭이 적힌 곳이 이 묶음뿐이다.
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
      {/* 되돌린 줄에는 **누가 거뒀는지**를 적는다 — 본인만 거둘 수 있지만, 이력이 화면에서도 읽혀야 한다. */}
      {row.revokedByName ? <p className="text-[11px] text-zinc-500">{row.revokedByName} 님이 되돌렸습니다.</p> : null}
    </li>
  );
}

export function DelegationSection({
  directory,
  made,
  acting,
  today,
  notice,
}: {
  /** 🔴 포털 번호가 빠진 명부. 못 받아 왔을 수 있고, 그것은 「한 명도 없다」와 다른 말이다. */
  directory: AsUserChoiceDirectory;
  made: DelegationRowView[];
  acting: DelegationRowView[];
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
                /* 🔵 되돌리기는 **맡긴 사람만** 할 수 있다 — 여기서는 단추를 내밀지 않는다(서버도 거절한다). */
                <DelegationRow key={row.id} row={row} lead="의 결재권을 대신하는 중" action={null} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
