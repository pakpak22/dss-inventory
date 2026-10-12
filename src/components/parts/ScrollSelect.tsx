"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * 짧게 펼쳐지는 고르기 상자 (2026-10-07 사용자: 항목 목록이 19개라 너무 길다 → **다섯 줄만 보이고 그 안에서 굴린다**).
 *
 * 네이티브 <select> 는 펼쳐지는 목록의 길이를 CSS 로 못 줄인다(브라우저가 그린다). 그래서 단추 + 목록(listbox)으로 만든다.
 * 라이브러리는 쓰지 않는다 (CLAUDE.md 9-1절). 값은 바깥이 들고 있고(주소 상태) 여기서는 고르기만 한다.
 *  - 바깥을 누르거나 Esc 를 치면 닫힌다. 위·아래 화살표로 옮기고 Enter 로 고른다.
 *  - 보이는 줄 수는 VISIBLE_ROWS. 줄 높이(ROW_PX)를 곱해 max-height 로 잘라 굴린다.
 */
export interface ScrollSelectOption {
  value: string;
  label: string;
}

const VISIBLE_ROWS = 5;
const ROW_PX = 32;

export function ScrollSelect({ value, options, onChange, ariaLabel, className }: { value: string; options: ScrollSelectOption[]; onChange: (value: string) => void; ariaLabel: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // 열릴 때 고른 줄이 보이게
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openList() {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }
  function pick(i: number) {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1 text-left text-sm text-zinc-900"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <span className="truncate">{current?.label ?? ""}</span>
        <span className="text-xs text-zinc-500">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={id}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 z-20 mt-1 min-w-full overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-md"
          style={{ maxHeight: VISIBLE_ROWS * ROW_PX + 8 }}
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={selected}
                className={`cursor-pointer px-3 text-sm whitespace-nowrap ${i === active ? "bg-zinc-100" : ""} ${selected ? "font-semibold text-zinc-900" : "text-zinc-700"}`}
                style={{ lineHeight: `${ROW_PX}px` }}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
              >
                {o.label}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
