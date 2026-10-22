import { REPAIR_CASE_HINT, REPAIR_CASE_TITLE, repairCaseGroups, type RepairCaseSnapshot } from "@/lib/stock/repair-case";

/**
 * **그 신청에 딸린 수리 건** — 기종 · L/N · S/N / 인수일 · 고객사 · End-User (2026-10-22, 쓰는 분 요청).
 *
 * 🔴 **두 화면이 이 하나를 같이 쓴다** — [부품 요청](`RequestManagerScreen`)과
 *    [승인요청건](`IssueApprovalScreen`). 같은 markup 을 두 곳에 베껴 적으면 「비면 안 그린다」가
 *    두 벌이 되고, 이 저장소에는 화면 렌더 시험이 없어 한쪽만 틀어져도 아무도 못 본다 —
 *    `RequestItemDetails` 를 떼어 낸 것과 같은 까닭·같은 처방이다.
 * 🔴 **무엇을 어떤 차례로 · 어떻게 묶을지 · 비면 안 그리는 것은 여기 적지 않는다.** 전부 순수 함수
 *    쪽이고(`@/lib/stock/repair-case`), 여기는 **받은 것을 그리기만** 한다.
 *
 * ── 🔴 **「신청 당시」라고 말한다 — 「최신입니다」로 읽히면 안 된다** ─────────
 * A/S 에서 모델·L/N·S/N·고객사·인수일을 나중에 고칠 수 있어서, 여기 글자는 언제든 옛것이 될 수 있다.
 * 가리는 것이 **둘**이다(하나만 두면 놓친다):
 *   ① **눈에 보이는 이름표** — 「수리 건 **(신청 당시)**」. 괄호 안이 핵심이다.
 *   ② **손 올렸을 때의 설명** — 그 뒤에 바뀌어도 여기 글자는 안 바뀐다는 사실까지 적는다.
 * 🔴 ①을 「수리 건」으로 줄이지 마라 — 네 글자만 남으면 사람은 당연히 지금 값으로 읽는다.
 *
 * 🔵 **상자 모양은 바로 옆의 「요청 비고」·「신청 사유」와 같다**(연회색 바탕의 작은 상자). 같은
 *    자리에 서는 「이 신청에 딸린 글」들이라 모양이 갈리면 사람이 다른 종류로 읽는다.
 * 🔵 `div` 인 까닭: 부르는 자리 둘이 `td` 안과 세로 flex 카드 안이라 블록이 와도 흐름이 안 깨진다.
 */
export function RepairCaseInfo({ repairCase }: { repairCase: RepairCaseSnapshot }) {
  const groups = repairCaseGroups(repairCase);
  // 🔴 여섯이 다 비면 **상자도 이름표도 안 선다** — 재고 관리에서 직접 올린 신청은 늘 그렇다.
  if (groups.length === 0) return null;
  return (
    <div className="mt-1 rounded-md bg-zinc-50 px-2 py-1 text-xs break-keep text-zinc-700" title={REPAIR_CASE_HINT}>
      {/* 🔴 ① 눈에 보이는 이름표. 🔵 값보다 옅고 가늘게 — 훑는 것은 값이다. */}
      <span className="block text-[11px] text-zinc-500">{REPAIR_CASE_TITLE}</span>
      {groups.map((group) => (
        // 🔵 묶음마다 제 줄 — 폭이 모자라 접혀도 **같은 것끼리 붙어** 있다(순수 함수 쪽 주석).
        <span key={group[0].key} className="block leading-snug">
          {group.map((d, i) => (
            <span key={d.key}>
              {/* 🔴 이름표+값은 **한 쌍으로 붙어 다닌다** — 좁은 칸에서 「L/N」만 윗줄에 남고 값이 아랫줄로 떨어졌다.
                  🔴 `inline-block` 이 **함께** 있어야 쌍이 통째로 내려간다(`whitespace-nowrap` 만으로는 inline 상자가 쪼개진다). */}
              <span className="inline-block whitespace-nowrap">
                <span className="text-zinc-400">{d.label} </span>
                {d.value}
              </span>
              {/* 🔴 구분자는 쌍 **앞이 아니라 뒤**다 — 앞에 찍으면 줄이 갈릴 때 「·」가 아랫줄 맨 앞에 혼자 선다.
                  🔴 그래서 줄바꿈 금지 **바깥**, 쌍과 쌍 **사이**에 둔다 — 안에 넣으면 앞 쌍에 묶여 함께 끌려 내려간다. */}
              {i < group.length - 1 ? <span className="text-zinc-300"> · </span> : null}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
