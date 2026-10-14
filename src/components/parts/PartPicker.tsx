"use client";

import { useMemo, useState } from "react";
import type { Owner } from "@/db/schema/codes";
import { OWNER_LABEL, formatQuantity } from "@/lib/parts/codes";
import { matchesPartQuery, tokenizePartQuery, type PartQueryFields } from "@/lib/parts/search";

/**
 * ============================================================================
 * 부품 고르개 — 찾아서 고른다 (공용)
 * ============================================================================
 * 2026-10-15(조각 9b)에 `src/components/stock/EntryForm.tsx` 안의 비공개 함수에서 꺼냈다.
 * 그 화면이 여섯 자리에서 쓰고, **O/H 부품 템플릿 화면**이 일곱째로 쓴다. 베껴 두면 한쪽만
 * 고쳐지는 날 「같은 부품을 고르는 일」이 화면마다 다른 뜻이 된다.
 *
 * 🔴 **거르는 규칙은 여기 없다** — `src/lib/parts/search.ts` 의 순수 함수에 있고 시험이 붙어
 * 있다. 화면 안에 묻어 두었던 동안은 「도번으로 찾아지는가」를 아무도 재어 보지 못했다.
 *
 * ── 🔵 소유·수량은 **있을 때만** 그린다 ─────────────────────────────────
 * 수량 변경 기록 화면은 부품 한 줄(`PartRow`)을 통째로 들고 있어 소유와 지금 수량을 보여 줄 수
 * 있다. O/H 템플릿 화면이 받는 목록(`listOhPartOptions`)에는 그 둘이 없다 — 그 화면은 수량을
 * 묻지 않으므로, 브라우저까지 실어 보낼 까닭도 없다. 없으면 그 조각만 빠지고 나머지는 같다.
 *
 * ── 🔴 고객사 품명을 함께 보여 준다 ─────────────────────────────────────
 * 찾는 칸에 들어 있는 글자가 결과에 안 보이면, 사람은 왜 이 줄이 나왔는지 알 수 없다.
 * 비어 있는 부품이 많으므로 **값이 있을 때만** 한 줄을 더한다.
 * ============================================================================
 */

/**
 * 고를 수 있는 부품 한 줄. 찾는 칸 여섯(`PartQueryFields`)에 id 를 더한 것이고, 소유·수량은
 * 있으면 함께 그린다(머리말). `PartRow` 가 이 모양을 그대로 품는다.
 */
export type PartPickerOption = PartQueryFields & {
  id: string;
  owner?: Owner;
  quantity?: number;
};

/** 많아도 이만큼만 보여 준다. 더 좁히라는 뜻이다. */
const MAX_HITS = 20;

const INPUT = "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900";
const LABEL = "flex flex-col gap-1 text-xs text-zinc-500";

/**
 * 부품 찾기: No.·품명·품명2·고객사 품명·도번·교산 품번으로 거른다. 많아도 20개만 보여 준다.
 *
 * 🔵 **고른 줄을 넘긴 모양 그대로 돌려준다**(제네릭) — 수량 변경 기록은 `PartRow` 를 넘기고
 * 그 줄의 소유·수량까지 쓰므로, 여기서 좁은 타입으로 깎아 돌려주면 부르는 쪽이 다시 찾아야 한다.
 */
export function PartPicker<T extends PartPickerOption>({
  parts,
  exclude,
  onPick,
  label,
}: {
  parts: T[];
  exclude: Set<string>;
  onPick: (p: T) => void;
  label: string;
}) {
  const [q, setQ] = useState("");
  const toks = tokenizePartQuery(q);
  const hits = useMemo(
    () => parts.filter((p) => !exclude.has(p.id)).filter((p) => matchesPartQuery(p, toks)).slice(0, MAX_HITS),
    [parts, exclude, toks],
  );
  return (
    <div className="flex flex-col gap-2">
      <label className={LABEL}>
        {label}
        <input
          type="search"
          className={INPUT}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="품명·도번·No. 로 찾기"
          autoComplete="off"
        />
      </label>
      {q && (
        <ul className="max-h-64 overflow-y-auto rounded-md border border-zinc-200">
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-zinc-500">맞는 부품이 없습니다.</li>
          ) : (
            hits.map((p) => {
              // 소유·지금 수량·도번. 없는 조각은 빠진다(머리말) — 글자를 잇는 방식은 그대로다.
              const meta = [
                p.owner === undefined ? "" : OWNER_LABEL[p.owner],
                p.quantity === undefined ? "" : `지금 ${formatQuantity(p.quantity)}개`,
                p.drawingNo,
              ]
                .filter((piece) => piece !== "")
                .join(" · ");
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-0.5 border-b border-zinc-100 px-3 py-2 text-left hover:bg-zinc-50 last:border-0"
                    onClick={() => {
                      onPick(p);
                      setQ("");
                    }}
                  >
                    <span className="text-sm font-medium text-zinc-900">
                      <span className="text-zinc-500">No. {p.no}</span> {p.name}
                      {p.name2 ? <span className="font-normal text-zinc-500"> · {p.name2}</span> : null}
                    </span>
                    {meta ? <span className="text-xs text-zinc-500">{meta}</span> : null}
                    {p.customerName ? <span className="text-xs text-zinc-500">고객사 품명 · {p.customerName}</span> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
