"use client";

import { type ReactNode, useMemo, useState } from "react";
import type { Owner } from "@/db/schema/codes";
import { OWNER_LABEL, formatQuantity } from "@/lib/parts/codes";
import { PART_FIELDS, type PartFieldKey } from "@/lib/parts/field-order";
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
 *
 * ── 🔴 `detailed` — **골라서 켜는** 자세한 줄 (2026-10-22 요청 1) ────────
 * 쓰는 분이 A/S 의 [수리 건 상세] 결과 줄을 짚으며 「**그 부품에 대한 모든 내용이 나온다** —
 * 이런 형식으로 해 달라」고 하셨다. 그 줄은 **셋**이고 차례가 정해져 있다:
 *   ① 고객사 품명 · 값          ② No. 번호 · 품명 · 품명2
 *   ③ 교산 품번 값 · 도번 값 · 소유 · 재고 N개
 * 🔴 **기본값은 `false` 다 — 안 넘긴 자리는 글자 하나 안 바뀐다.** 이 고르개를 쓰는 자리가
 *    `src/components/stock/EntryForm.tsx` 에만 **다섯**이고, 쓰는 분이 바꿔 달라고 한 화면은
 *    O/H 템플릿 하나다. 켠 자리만 모양이 바뀐다.
 * 🔴 **거르는 규칙은 안 건드렸다** — 여섯 칸으로 찾는 것은 A/S 와 같고, 그 규칙은
 *    `src/lib/parts/search.ts` 의 순수 함수에 시험과 함께 있다.
 *
 * ── 🔵 [추가] 는 **딱지**이지 단추가 아니다 ─────────────────────────────
 * A/S 는 줄 오른쪽에 진짜 [추가] 단추를 둔다 — 그 줄 **안에 다른 단추**(고객사 품명 채우기)가
 * 있어서 줄 전체를 단추로 만들 수 없기 때문이다. 여기 줄에는 그런 단추가 없고, **줄 아무 데나
 * 눌러서 고르는 것**이 이 고르개를 쓰는 여섯 자리가 이미 기대하는 동작이다. 그래서 줄은 그대로
 * 단추로 두고 오른쪽 끝에 **눌러서 고른다는 표시**만 세운다(단추 안에 단추는 못 넣는다).
 *
 * ── 🔵 「(불러온 때 기준)」을 따라 적지 않았다 ──────────────────────────
 * A/S 는 재고 수에 그 꼬리말을 붙인다. 그쪽은 그 수를 **남의 시스템(재고 관리)에 물어 받아 온
 * 값**이라 제 힘으로 다시 읽을 수 없어서다. 여기서는 그 수가 **이 시스템 제 DB** 에서, 화면의
 * 나머지 값과 **같은 한 번의 렌더**에 읽힌다 — 그 꼬리말이 가리키는 사정이 여기엔 없다.
 * 🔴 참이 아닌 단서를 베껴 적으면 사람이 멀쩡한 수를 의심한다.
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
 * 🔴 **줄 하나의 겉모양. 기본 쪽은 글자 하나 바뀌면 안 된다** — 이 고르개를 쓰는 다섯 자리
 * (`src/components/stock/EntryForm.tsx`)가 지금 그대로여야 한다(머리말).
 */
const ROW_PLAIN =
  "flex w-full flex-col gap-0.5 border-b border-zinc-100 px-3 py-2 text-left hover:bg-zinc-50 last:border-0";
/** 자세한 줄은 왼쪽에 글 세 줄, 오른쪽 끝에 [추가] 딱지가 선다(머리말). */
const ROW_DETAILED =
  "flex w-full items-start justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-left hover:bg-zinc-50 last:border-0";

/**
 * 값을 눈에 띄게 하는 색 — 🔴 **값에만** 입힌다. 이름표(「도번」·「재고」)는 회색 그대로다:
 * 색이 이름표까지 번지면 눈이 어디에 멎어야 하는지가 다시 흐려진다.
 * 🔵 이 저장소에는 다크 모드가 없다(`dark:` 를 쓰는 화면이 한 곳도 없다) — 짝을 적지 않는다.
 */
const VALUE_HIGHLIGHT = "text-blue-700";

/** 이름표를 글자로 꺼낼 자리. 🔴 말도 차례도 `PART_FIELDS` 한 곳이 쥔다(field-order.ts 머리말). */
const FIELD_LABEL = Object.fromEntries(PART_FIELDS.map((f) => [f.key, f.label])) as Record<PartFieldKey, string>;

/**
 * 셋째 줄에 이름표를 달고 늘어놓는 칸 둘 — 교산 품번 · 도번.
 * 🔴 **차례를 여기서 다시 적지 않는다** — `PART_FIELDS` 를 걸러 쓰므로 그 표가 바뀌면 함께 바뀐다.
 * 🔵 품명·품명2·고객사 품명이 빠진 까닭: 앞 두 줄이 이미 그 셋을 제 자리에 그린다.
 */
const ID_FIELD_KEYS: readonly PartFieldKey[] = ["kyosanPartNo", "drawingNo"];
const ID_FIELDS = PART_FIELDS.filter((f) => ID_FIELD_KEYS.includes(f.key));

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
  detailed = false,
}: {
  parts: T[];
  exclude: Set<string>;
  onPick: (p: T) => void;
  label: string;
  /**
   * 🔴 **골라서 켜는 자세한 줄**(머리말). 안 넘기면 지금까지의 그 줄 그대로다 — 이 고르개를
   * 쓰는 다섯 자리가 바뀌지 않아야 해서 기본값이 `false` 다.
   */
  detailed?: boolean;
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
                    className={detailed ? ROW_DETAILED : ROW_PLAIN}
                    onClick={() => {
                      onPick(p);
                      setQ("");
                    }}
                  >
                    {detailed ? (
                      <DetailedRow part={p} />
                    ) : (
                      <>
                        <span className="text-sm font-medium text-zinc-900">
                          <span className="text-zinc-500">No. {p.no}</span> {p.name}
                          {p.name2 ? <span className="font-normal text-zinc-500"> · {p.name2}</span> : null}
                        </span>
                        {/* 🔴 고객사 품명이 **도번보다 먼저** 선다 — 부품 칸의 차례는 `PART_FIELDS` 가 쥔다(2026-10-16).
                            품명·품명2 는 머리줄(위)이라 그 자리를 옮기지 않는다(그 까닭은 field-order.ts 머리말). */}
                        {p.customerName ? <span className="text-xs text-zinc-500">고객사 품명 · {p.customerName}</span> : null}
                        {meta ? <span className="text-xs text-zinc-500">{meta}</span> : null}
                      </>
                    )}
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

/**
 * ============================================================================
 * 자세한 줄 — **그 부품에 대한 내용이 한 줄에 다 나온다** (2026-10-22 요청 1)
 * ============================================================================
 * A/S 의 [수리 건 상세] 결과 줄과 **같은 차례**다. 줄 셋 + 오른쪽 [추가] 딱지(머리말).
 *
 * 🔴 **고객사 품명이 맨 위다** — 견적서가 이 이름으로 나가고, O/H 템플릿에서는 고른 순간 이 값이
 *    그 줄에 저장되는 품명이 된다. 비어 있으면 **「없음」을 적는다**: 빈 자리로 두면 사람은 그 칸을
 *    못 보고 골라 버리고, 그 줄은 견적서의 품명 칸이 비어 나간다.
 * 🔵 A/S 는 그 자리에 **채우는 단추**까지 둔다. 여기는 줄 전체가 단추라 넣을 수 없고(단추 안에
 *    단추), 고른 뒤 O/H 템플릿 줄에 「고객사 품명 정하러 가기」가 그대로 선다 — 길이 사라지지 않는다.
 */
function DetailedRow({ part }: { part: PartPickerOption }) {
  /**
   * 셋째 줄 토막들. 🔴 **값이 있는 것만** 선다 — 「교산 품번 없음 · 도번 없음」이 줄줄이 적히면
   * 정작 있는 값이 묻힌다. 🔵 없는 조각은 빠지고 잇는 방식(` · `)은 그대로다.
   */
  const pieces: { key: string; node: ReactNode }[] = [];
  for (const field of ID_FIELDS) {
    const value = part[field.key as "kyosanPartNo" | "drawingNo"];
    if (value === "") continue;
    pieces.push({
      key: field.key,
      node: (
        <>
          {/* 🔴 어느 것이 도번인지를 **글자를 짐작해 견주지 않는다** — `PART_FIELDS` 의 키로 가른다.
              이름표가 바뀌는 날에도 색이 조용히 빠지지 않는다. */}
          {field.label}{" "}
          {field.key === "drawingNo" ? <span className={VALUE_HIGHLIGHT}>{value}</span> : value}
        </>
      ),
    });
  }
  if (part.owner !== undefined) pieces.push({ key: "owner", node: OWNER_LABEL[part.owner] });
  if (part.quantity !== undefined) {
    pieces.push({
      key: "stock",
      // 🔴 **수에만** 색이 들어간다 — 「재고」는 이름표라 회색 그대로다.
      // 🔵 「(불러온 때 기준)」을 안 붙인다 — 그 꼬리말이 가리키는 사정이 여기엔 없다(머리말).
      node: (
        <>
          재고 <span className={VALUE_HIGHLIGHT}>{formatQuantity(part.quantity)}개</span>
        </>
      ),
    });
  }

  return (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        {/* ① 고객사 품명 */}
        {part.customerName ? (
          <span className="text-xs text-zinc-500">
            {FIELD_LABEL.customerName} · {part.customerName}
          </span>
        ) : (
          <span className="text-xs text-amber-700">{FIELD_LABEL.customerName} 없음</span>
        )}
        {/* ② No. · 품명 · 품명2 — 줄의 머리다. 어느 줄인지 가리는 자리라 차례를 옮기지 않는다. */}
        <span className="text-sm font-medium text-zinc-900">
          <span className="text-zinc-500">No. {part.no}</span> {part.name}
          {part.name2 ? <span className="font-normal text-zinc-500"> · {part.name2}</span> : null}
        </span>
        {/* ③ 교산 품번 · 도번 · 소유 · 재고 */}
        {pieces.length > 0 && (
          <span className="text-xs text-zinc-500">
            {pieces.map((piece, index) => (
              <span key={piece.key}>
                {index > 0 ? " · " : null}
                {piece.node}
              </span>
            ))}
          </span>
        )}
      </span>
      {/* 🔵 단추가 아니라 **딱지**다 — 줄 전체가 단추다(머리말). */}
      <span className="shrink-0 self-center rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700">
        추가
      </span>
    </>
  );
}
