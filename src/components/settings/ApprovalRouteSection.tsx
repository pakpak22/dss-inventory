"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { saveApprovalRouteAction } from "@/app/actions/approval-routes";
import {
  approverNoticeFor,
  asUserChoiceLabel,
  asUserLabel,
  AS_DIRECTORY_MESSAGES,
  type AsUserChoiceDirectory,
} from "@/lib/approval/directory";
import {
  APPROVAL_ROUTE_EMPTY_NOTICES,
  APPROVAL_ROUTE_SCOPE_LABELS,
  APPROVAL_ROUTE_SCOPES,
  isApprovalRouteScope,
  isSameRouteStepList,
  MAX_APPROVAL_ROUTE_STEPS,
  moveRouteStepDown,
  moveRouteStepUp,
  removeRouteStep,
  stepOrderFromIndex,
  validateApprovalRouteSteps,
  type ApprovalRouteScope,
} from "@/lib/approval/route";
// 🔴 `queries.ts` 가 아니라 타입만 든 `view.ts` 에서 가져온다 — 그쪽은 server-only 다(view.ts 머리말).
import type { ApprovalRouteView } from "@/lib/approval/view";

/**
 * ============================================================================
 * 승인 절차(결재선) 편집 — 용도 고르기 + 순서 목록 + 미리보기
 * ============================================================================
 * A/S 의 `src/components/users/ShipmentApprovalRouteSection.tsx` 를 모양 그대로 옮겨 온
 * 것이다(2026-10-15, 조각 ③b). 그래프 편집기가 아니다 — 순서는 **일렬**이고(갈래도 병렬
 * 승인도 없다), 자리를 바꾸는 일은 [▲][▼] 로 배열 원소를 옮기는 것이 전부다. 그 배열 조작과
 * 「바뀐 게 있는가」 판정은 순수 함수로 `src/lib/approval/route.ts` 에 있다 — 이 화면은 서버
 * 액션을 물고 있어(그 사슬 끝에 `server-only` 가 있다) 렌더 시험이 붙지 않으므로, 실수가 나기
 * 쉬운 부분을 시험이 붙는 자리로 내려 두었다.
 *
 * ── 🔴 용도(scope)마다 판이 따로 쌓인다 ─────────────────────────────────
 * 판 번호도 「현재 절차」도 용도 안에서 정해지므로, 한쪽을 고쳐도 다른 쪽은 흔들리지 않는다.
 * 2026-10-22 에 용도가 셋이 되었다 — 부품 불출 · 매쳐 부품 불출 · 제너레이터 부품 불출.
 * 🔴 **셋 다 실제로 신청을 받는다**(2026-10-22). 어느 신청이 어느 용도로 가는지는 그 신청에 딸린
 * 수리 건의 종류가 정하고 그 짝은 한 곳에 적혀 있다(`approvalRouteScopeForWorkflowKind`). 용도마다
 * 「단계를 안 넣으면 무슨 일이 일어나는가」는 빈 상태 안내문(`APPROVAL_ROUTE_EMPTY_NOTICES`)이
 * 말해 준다 — 셋 다 「결재 없이 담당자가 그 자리에서 바로 불출한다」로 끝난다.
 *
 * 🔴 **그래서 편집 중이던 목록도 용도별로 갈라 둔다**(`draftByScope`). 목록을 하나만 두고
 * 용도만 갈아 끼우면, 한 절차를 짜다가 용도를 바꾸고 [저장] 을 누른 순간 **그 사람들이 다른
 * 절차로 저장된다.** 갈라 두면 그 길 자체가 없어지고, 덤으로 편집하던 것이 사라지지도 않는다.
 *
 * ── 🔴 단계 0개로 저장하는 길을 막지 않는다 ─────────────────────────────
 * 판은 지우지 않으므로(append-only) **0개짜리 판을 얹는 것이 절차를 끄는 유일한 출구다.**
 * [저장] 을 「단계가 1개 이상일 때만」으로 잠그면 한 번 켠 절차를 되돌릴 방법이 영영 없어진다.
 *
 * ── 🔴 「못 받아 왔다」를 「없다」로 그리지 않는다 ───────────────────────
 * 결재자는 A/S 의 사람이라 명부가 저쪽에 있다. A/S 가 꺼져 있으면 **고르개를 비우고 그 사실을
 * 말하되**, 이미 저장된 결재선은 우리 표의 이름·역할 사본으로 **그대로 보여 준다.** 못 받아 온
 * 것을 「자격 없음」으로 그리면 멀쩡한 결재선이 깨진 것처럼 보이고, 관리자는 멀쩡한 단계를
 * 지운다. 「모른다」와 「없다」를 가르는 판정은 `src/lib/approval/directory.ts` 에 있다.
 *
 * ── 🔴 자격을 잃은 사람을 조용히 빼지 않는다 ────────────────────────────
 * 결재선에 올라간 뒤 계정이 잠기거나 지워지는 일은 실제로 일어나고, 그때 결재는 그 단계에서
 * 멈춘다. 줄은 그대로 두고 왜 안 되는지를 그 자리에 적는다 — 조용히 빼면 절차가 짧아진 것처럼
 * 보이고, 「왜 결재가 안 넘어가지」를 아무도 답할 수 없다.
 *
 * ── 🔴 통합 로그인 기록이 없는 사람은 **고를 수 없다**(2026-10-15) ───────
 * 결재자 판정의 열쇠는 포털 번호다(`src/lib/approval/directory.ts` 머리말). 포털로 한 번도
 * 들어온 적 없는 사람을 결재선에 세우면 그 단계는 **아무도 열 수 없는 문**이 된다. 그래서
 * 고르개에서 **잠그되 목록에서 빼지는 않고**, 까닭을 그 줄에 적는다 — 빼 버리면 「왜 저 사람이
 * 목록에 없지」가 되고, 관리자는 A/S 가 고장 난 줄 안다(위 규칙과 같은 판단이다).
 *
 * 🔵 **포털 번호 자체는 이 화면에 내려오지 않는다.** 신원 증명에 쓰이는 값이라 서버가
 * `selectable`·`approverHasSub` 라는 **참/거짓 한 칸**으로 바꿔 보낸다.
 * ============================================================================
 */

const SELECT_CLASS =
  "w-full min-w-0 rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500";

const ICON_BUTTON_CLASS =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs leading-none text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * 용도별 현재 판. **모든 용도가 키로 있어야 한다** — 서버 페이지가 용도 목록을 돌며 읽어
 * 채우므로, 용도를 하나 더하면 그 자리가 컴파일러에 바로 보인다. 값이 `null` 인 것은 그 용도의
 * 판이 아직 하나도 없다는 뜻이다(정상이다).
 */
export type ApprovalRoutesByScope = Record<ApprovalRouteScope, ApprovalRouteView | null>;

/**
 * 화면을 처음 열었을 때 보이는 용도.
 *
 * 🔴 **「모름」이 떨어지는 자리**를 연다. 2026-10-22 에 신청이 종류별로 갈린 뒤에도 그대로인
 * 까닭은, 수리 건이 없는 신청·재고 관리에서 직접 올린 신청·종류를 못 받은 신청이 전부 이 절차를
 * 타서 **어느 신청이든 걸릴 수 있는 유일한 용도**이기 때문이다. 나머지 둘은 그 종류의 수리 건이
 * 있을 때만 쓰이므로, 먼저 보여 주면 관리자는 자기 회사와 상관없을 수도 있는 절차부터 읽게 된다.
 */
const DEFAULT_SCOPE: ApprovalRouteScope = "PART_ISSUE";

export function ApprovalRouteSection({
  routes,
  directory,
}: {
  /** 용도별 현재 절차(그 용도 안에서 version 이 가장 큰 판). 판이 없으면 null 이다. */
  routes: ApprovalRoutesByScope;
  /**
   * A/S 사람 명부. 🔴 못 받아 왔을 수 있고, 그것은 「한 명도 없다」와 다른 말이다.
   * 🔵 **포털 번호가 빠진 모양**이다(`AsUserChoice`) — 서버가 `toAsUserChoiceDirectory` 로
   * 바꿔서 내려보낸다.
   */
  directory: AsUserChoiceDirectory;
}) {
  const router = useRouter();

  // 용도별 「저장돼 있는 목록」과 그 지문. 지문이 달라지면 그 용도만 다시 맞춘다.
  const savedByScope = {} as Record<ApprovalRouteScope, string[]>;
  const savedKeyByScope = {} as Record<ApprovalRouteScope, string>;
  for (const routeScope of APPROVAL_ROUTE_SCOPES) {
    savedByScope[routeScope] = (routes[routeScope]?.steps ?? []).map((step) => step.approverUserId);
    savedKeyByScope[routeScope] = savedByScope[routeScope].join("|");
  }

  const [scope, setScope] = useState<ApprovalRouteScope>(DEFAULT_SCOPE);
  const [draftByScope, setDraftByScope] = useState<Record<ApprovalRouteScope, string[]>>(savedByScope);
  const [syncedKeyByScope, setSyncedKeyByScope] = useState<Record<ApprovalRouteScope, string>>(savedKeyByScope);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 저장 뒤 router.refresh() 로 새 자료가 내려오면 편집 중이던 목록을 그것에 맞춘다. 다른
  // 관리자가 먼저 바꾼 경우에도 화면이 옛 값을 붙들고 있지 않게 하는 자리다(렌더 중 setState —
  // 자료가 바뀐 그 렌더에서 바로 반영된다).
  //
  // 🔴 **바뀐 용도만 맞춘다.** 한 용도를 저장했다고 다른 용도의 편집 중이던 목록까지 되돌리면,
  // 사람은 자기가 짜던 것이 왜 사라졌는지 알 수 없다.
  const staleScopes = APPROVAL_ROUTE_SCOPES.filter(
    (routeScope) => syncedKeyByScope[routeScope] !== savedKeyByScope[routeScope],
  );
  if (staleScopes.length > 0) {
    setSyncedKeyByScope(savedKeyByScope);
    setDraftByScope((previous) => {
      const next = { ...previous };
      for (const routeScope of staleScopes) next[routeScope] = savedByScope[routeScope];
      return next;
    });
  }

  const route = routes[scope];
  const savedApproverIds = savedByScope[scope];
  // 🔴 저장할 목록은 **고른 용도의 것**이다. 이 한 줄이 「다른 용도로 잘못 저장되는 길」을
  // 없앤다 — 목록과 용도가 같은 열쇠에서 나온다.
  const steps = draftByScope[scope];

  const candidates = directory.status === "ok" ? directory.users : [];
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  // 저장돼 있는 단계의 이름·역할 사본. A/S 가 꺼져 있어도 이것으로 줄을 그린다.
  const savedStepById = new Map((route?.steps ?? []).map((step) => [step.approverUserId, step]));

  /** 그 줄에 보일 이름. 명부에 없으면 저장돼 있던 이름으로 버틴다. */
  function approverLabel(approverUserId: string): string {
    const candidate = candidateById.get(approverUserId);
    // 고를 수 없는 사람이면 까닭이 이름 뒤에 붙는다 — 이미 골라 둔 줄에도 그대로 보여야 한다.
    if (candidate) return asUserChoiceLabel(candidate);
    const saved = savedStepById.get(approverUserId);
    if (saved) return asUserLabel({ name: saved.approverName, role: saved.approverRole });
    return "알 수 없는 사용자";
  }

  function update(next: string[]) {
    setDraftByScope((previous) => ({ ...previous, [scope]: next }));
    setMessage(null);
  }

  function changeScope(next: ApprovalRouteScope) {
    if (next === scope) return;
    setScope(next);
    // 🔴 결과 문구는 방금까지 보던 용도의 것이다. 데리고 가면 새 용도에 대한 말처럼 읽힌다.
    setMessage(null);
  }

  async function handleSave() {
    // 화면과 서버가 **같은 함수**를 본다. 여기서 먼저 보는 이유는 왕복 한 번을 아끼기
    // 위해서일 뿐, 최종 판정은 서버가 다시 한다.
    const checked = validateApprovalRouteSteps(steps);
    if (!checked.ok) {
      setMessage(checked.message);
      return;
    }

    setIsSaving(true);
    setMessage(null);
    // 🔴 용도와 목록이 **같은 렌더의 같은 열쇠**에서 나온다. 서버는 기본값으로 채워 주지
    // 않으므로 여기서 반드시 적어야 하고, 적는 값은 지금 보고 있는 그 용도여야 한다.
    const result = await saveApprovalRouteAction({ scope, approverUserIds: steps });
    setIsSaving(false);
    setMessage(result.message);
    if (!result.ok) return;
    router.refresh();
  }

  // 🔴 **저장돼 있는** 판에 통합 로그인 번호가 없는 단계가 몇 개인가. 편집 중인 목록이 아니라
  // 저장된 것을 센다 — 그 판으로 결재건이 올라가기 때문이다.
  const savedStepsWithoutSub = (route?.steps ?? []).filter((step) => !step.approverHasSub).length;

  const scopeLabel = APPROVAL_ROUTE_SCOPE_LABELS[scope];
  const atStepLimit = steps.length >= MAX_APPROVAL_ROUTE_STEPS;
  const hasUnsavedChange = !isSameRouteStepList(savedApproverIds, steps);
  // 다른 용도에 손대다 만 것이 있는가. 갈라 두었기 때문에 사라지지는 않지만, 말해 주지 않으면
  // 사람은 저장된 줄 알고 화면을 닫는다.
  const otherUnsavedScopes = APPROVAL_ROUTE_SCOPES.filter(
    (routeScope) =>
      routeScope !== scope && !isSameRouteStepList(savedByScope[routeScope], draftByScope[routeScope]),
  );

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">승인 절차</h2>
      <p className="mt-1 text-xs text-zinc-500">
        {scopeLabel}을 여러 사람이 순서대로 결재하도록 지정합니다. 위에서부터 차례로 승인합니다.
      </p>

      {/* 🔴 용도 고르기. 용도마다 판이 따로 쌓이고, 편집 중이던 목록도 따로 산다 — 여기서 고른
          값 하나가 「무엇을 보여 줄지」와 「어디에 저장할지」를 함께 정한다. 저장하는 동안은
          잠근다: 요청이 도는 중에 용도를 바꾸면 돌아온 결과 문구가 엉뚱한 절차 아래에 붙는다. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="approval-route-scope" className="text-xs font-medium text-zinc-700">
          어떤 승인
        </label>
        <select
          id="approval-route-scope"
          value={scope}
          disabled={isSaving}
          onChange={(event) => {
            const next = event.target.value;
            // 고른 값을 그대로 믿지 않는다 — 같은 판정으로 좁힌다(형변환을 손으로 적으면
            // 목록에 없는 값도 타입만 통과한다).
            if (isApprovalRouteScope(next)) changeScope(next);
          }}
          className="min-w-0 rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500"
        >
          {APPROVAL_ROUTE_SCOPES.map((routeScope) => (
            <option key={routeScope} value={routeScope}>
              {APPROVAL_ROUTE_SCOPE_LABELS[routeScope]}
            </option>
          ))}
        </select>
        {route && (
          <span className="text-[11px] text-zinc-400">
            현재 {route.version}번째 판 · {route.createdByName} 님이 저장
          </span>
        )}
      </div>

      {/* 🔴 명부를 못 받아 왔을 때. **「없습니다」라고 말하지 않는다** — 저장된 결재선은 아래에
          그대로 보이고, 지금 할 수 없는 일(새로 고르기)만 말한다. */}
      {directory.status !== "ok" && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          {AS_DIRECTORY_MESSAGES[directory.reason]} 아래 결재선은 저장된 내용 그대로이며, 지금은 단계를 새로 고를
          수 없습니다. 이미 저장된 절차는 그대로 돌아갑니다.
        </p>
      )}

      {/* 🔴 **지금 저장돼 있는 판**에 통합 로그인 번호가 없는 단계가 있다. 그대로 두면 결재건을
          올릴 수 없다(올리는 쪽이 거절한다) — 그 사실이 신청하는 사람 쪽에서만 드러나면 아무도
          어디를 고쳐야 하는지 모른다. 번호를 적기 전에 저장된 옛 판이 여기 걸린다. */}
      {savedStepsWithoutSub > 0 && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          지금 저장된 결재선에는 통합 로그인 번호가 없는 단계가 {savedStepsWithoutSub}개 있습니다. 그대로 두면 이
          절차로는 결재를 올릴 수 없습니다 — 아래 목록을 확인하고 [저장]을 다시 눌러 주십시오.
        </p>
      )}

      {/* 🔴 결과 문구는 이 카드 **안**에 둔다. 카드 밖 형제로 두면 부모가 격자일 때 이 문단이
          칸 하나를 먹어 배치가 깨진다(원본 저장소에서 실제로 있었다). */}
      {message && (
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700">{message}</p>
      )}

      {steps.length === 0 ? (
        // 🔴 빈 화면만 두면 관리자는 기능이 고장 난 줄 안다. 지금 무엇이 일어나고 있는지를
        // 적어 준다 — 그 한 문장은 **용도마다 다르다.** 저장돼 있던 절차를 방금 비운 중이라면
        // 「아직 없습니다」가 아니라 「저장하면 꺼집니다」다: 그것이 절차를 끄는 유일한 출구다.
        <p className="mt-4 rounded-lg border border-zinc-200 px-3 py-6 text-center text-xs text-zinc-500">
          {savedApproverIds.length === 0
            ? `아직 승인 절차가 없습니다. ${APPROVAL_ROUTE_EMPTY_NOTICES[scope]}`
            : `단계를 모두 지웠습니다. 이대로 저장하면 승인 절차가 꺼집니다 — ${APPROVAL_ROUTE_EMPTY_NOTICES[scope]}`}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {steps.map((approverUserId, index) => {
            const warning = approverNoticeFor(directory, approverUserId);
            const isOrphan = approverUserId !== "" && !candidateById.has(approverUserId);
            return (
              <li key={index} className="flex flex-col gap-1 rounded-md border border-zinc-100 p-2">
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-xs font-medium text-zinc-500">
                    {stepOrderFromIndex(index)}단계
                  </span>
                  <select
                    value={approverUserId}
                    aria-label={`${stepOrderFromIndex(index)}단계 승인자`}
                    onChange={(event) => {
                      const next = [...steps];
                      next[index] = event.target.value;
                      update(next);
                    }}
                    className={SELECT_CLASS}
                  >
                    <option value="">선택하세요</option>
                    {/* 명부에 없는 사람도 자리를 지키게 한다 — 옵션이 없으면 고른 값이
                        화면에서 조용히 사라진다. A/S 가 꺼져 있으면 모든 줄이 여기로 온다. */}
                    {isOrphan && <option value={approverUserId}>{approverLabel(approverUserId)}</option>}
                    {/* 🔴 통합 로그인 기록이 없는 사람은 **잠그되 목록에 둔다**(머리말). 빼
                        버리면 「왜 저 사람이 없지」가 되고, 잠가 두면 까닭이 그 자리에 보인다. */}
                    {candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id} disabled={!candidate.selectable}>
                        {asUserChoiceLabel(candidate)}
                      </option>
                    ))}
                  </select>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`${stepOrderFromIndex(index)}단계를 위로`}
                      disabled={index === 0}
                      onClick={() => update(moveRouteStepUp(steps, index))}
                      className={ICON_BUTTON_CLASS}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`${stepOrderFromIndex(index)}단계를 아래로`}
                      disabled={index === steps.length - 1}
                      onClick={() => update(moveRouteStepDown(steps, index))}
                      className={ICON_BUTTON_CLASS}
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      aria-label={`${stepOrderFromIndex(index)}단계를 삭제`}
                      onClick={() => update(removeRouteStep(steps, index))}
                      className={ICON_BUTTON_CLASS}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {warning && <p className="pl-12 text-[11px] text-amber-700">{warning}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={atStepLimit}
          onClick={() => update([...steps, ""])}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + 단계 추가
        </button>
        {atStepLimit && (
          <span className="text-[11px] text-zinc-400">
            승인 단계는 최대 {MAX_APPROVAL_ROUTE_STEPS}개까지 둘 수 있습니다.
          </span>
        )}
        {/* 🔴 잠그는 조건은 「저장 중인가」 하나다. 단계 수를 보고 잠그면 0개짜리 판을 얹을 수
            없게 되고, 그 순간 한 번 켠 절차를 끌 방법이 사라진다. */}
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void handleSave()}
          className="ml-auto rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? "저장 중..." : "저장"}
        </button>
        {hasUnsavedChange && !isSaving && (
          <span className="w-full text-[11px] text-amber-700">저장하지 않은 변경이 있습니다.</span>
        )}
        {otherUnsavedScopes.length > 0 && (
          <span className="w-full text-[11px] text-amber-700">
            {otherUnsavedScopes.map((routeScope) => APPROVAL_ROUTE_SCOPE_LABELS[routeScope]).join(" · ")}
            에도 저장하지 않은 변경이 있습니다. 그 승인을 골라 따로 저장해 주십시오.
          </span>
        )}
      </div>

      {steps.length > 0 && (
        <div className="mt-5 border-t border-zinc-100 pt-4">
          <h3 className="text-xs font-medium text-zinc-500">미리보기</h3>
          {/* 🔴 가로로 길어지면 이 상자 안에서만 밀린다 — 화면 전체가 옆으로 밀리면 다른 설정까지
              못 쓰게 된다. 그래프 라이브러리는 쓰지 않는다: 일렬이라 상자와 화살표 글자로 충분하다. */}
          <div className="mt-2 overflow-x-auto pb-1">
            <div className="flex min-w-max items-start gap-2">
              {steps.map((approverUserId, index) => (
                <Fragment key={index}>
                  {index > 0 && (
                    <span aria-hidden className="self-center text-sm text-zinc-400">
                      ▶
                    </span>
                  )}
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={`whitespace-nowrap rounded-md border px-3 py-2 text-xs ${
                        approverNoticeFor(directory, approverUserId)
                          ? "border-amber-300 text-amber-700"
                          : "border-zinc-300 text-zinc-900"
                      }`}
                    >
                      {approverUserId === "" ? "미지정" : approverLabel(approverUserId)}
                    </span>
                    <span className="text-[11px] text-zinc-400">{stepOrderFromIndex(index)}단계</span>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
