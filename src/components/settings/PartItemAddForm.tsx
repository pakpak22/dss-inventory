"use client";

import { startTransition, useActionState, useState } from "react";
import { createPartItemAction, type PartItemFormState } from "@/app/actions/part-items";

const EMPTY_PART_ITEM_FORM_STATE: PartItemFormState = { errors: {}, values: { code: "", name: "" }, added: null };

/** 항목 추가 폼 (관리자, DESIGN 2-7절). 한글 이름과 영문 코드. */
export function PartItemAddForm() {
  const [state, formAction, pending] = useActionState<PartItemFormState, FormData>(createPartItemAction, EMPTY_PART_ITEM_FORM_STATE);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  // 추가가 되면 서버가 빈 값을 돌려준다. 그때 입력 칸도 비운다 (파생 상태: 렌더 중 맞춤).
  const [seenAdded, setSeenAdded] = useState<string | null>(null);
  if (state.added !== seenAdded) {
    setSeenAdded(state.added);
    if (state.added) {
      setCode("");
      setName("");
    }
  }
  const INPUT = "rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900";

  return (
    <form
      onSubmit={(e) => {
        // 제출을 직접 다룬다 — <form action> 은 액션 뒤 폼을 초기화해 오류가 났을 때 친 값이 사라진다. 성공 때는 위에서 비운다.
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="rounded-lg border border-zinc-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-zinc-900">항목 추가</h2>
      <p className="mt-1 text-xs text-zinc-500">이름은 화면과 엑셀에 보이는 한글, 코드는 저장과 다른 시스템에 내줄 영문 값입니다. 둘 다 나중에 바꿀 수 없습니다.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          이름 *
          <input name="name" className={`${INPUT} ${state.errors.name ? "border-red-400" : ""}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required placeholder="예: 센서" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          코드 *
          <input
            name="code"
            className={`${INPUT} font-mono uppercase ${state.errors.code ? "border-red-400" : ""}`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={40}
            required
            placeholder="예: SENSOR"
            pattern="[A-Za-z][A-Za-z0-9_]*"
          />
        </label>
        <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50" disabled={pending}>
          {pending ? "추가 중" : "추가"}
        </button>
      </div>
      {state.errors.name ? <p className="mt-2 text-xs text-red-600">{state.errors.name}</p> : null}
      {state.errors.code ? <p className="mt-2 text-xs text-red-600">{state.errors.code}</p> : null}
      {state.errors.form ? <p className="mt-2 text-xs text-red-600">{state.errors.form}</p> : null}
      {state.added && !pending ? <p className="mt-2 text-xs text-zinc-700">「{state.added}」 항목이 추가되었습니다.</p> : null}
    </form>
  );
}
