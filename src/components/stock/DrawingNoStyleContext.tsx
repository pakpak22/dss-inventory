"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DRAWING_NO_STYLE_DEFAULT, type DrawingNoStyle } from "@/lib/stock/drawing-no-style";

/**
 * **저장된 도번 모양을 화면 전체에 내려보내는 자리** (2026-11-20).
 *
 * ── 🔴 왜 프롭이 아니라 Context 인가 ─────────────────────────────────────
 * 도번 줄을 그리는 조각(`RequestItemDetails`)을 쓰는 화면이 **셋**이고(부품 요청 관리 · 승인
 * 요청건 · 불출 신청 팝업), 그 셋은 또 저마다 **여러 겹 안쪽**에 있다. 프롭으로 내리면 값을
 * 쓰지도 않는 조각 대여섯이 같은 프롭을 받아 넘기기만 하고, 그러다 **한 자리만 안 넘기면 그
 * 화면에서만 기본값으로 선다** — 오류가 나지 않아 아무도 모른다.
 *
 * 🔴 **읽는 자리는 인증 구간 레이아웃 하나다**(`src/app/(app)/layout.tsx`). 화면마다 따로 읽으면
 *    같은 값을 여러 번 묻게 되고, 새 화면이 생길 때마다 읽는 줄을 더해야 한다.
 * 🔴 **감싸지 않은 자리에서도 화면은 서야 한다** — 그래서 기본값이 Context 의 기본값이다.
 *    `null` 로 두고 「없으면 안 그린다」로 가면 레이아웃 바깥(인쇄 화면 등)에서 도번이 통째로
 *    사라지는데, 그것은 **설정과 아무 상관 없는 자리에서 값이 없어지는** 일이다.
 * 🔵 값은 **읽기 전용**이다 — 바꾸는 길은 설정 화면의 서버 액션 하나뿐이고, 저장하면
 *    `router.refresh()` 로 레이아웃이 다시 읽어 내려온다.
 */
const DrawingNoStyleContext = createContext<DrawingNoStyle>(DRAWING_NO_STYLE_DEFAULT);

export function DrawingNoStyleProvider({ value, children }: { value: DrawingNoStyle; children: ReactNode }) {
  return <DrawingNoStyleContext.Provider value={value}>{children}</DrawingNoStyleContext.Provider>;
}

/** 지금 화면이 쓸 도번 모양. 🔵 감싼 자리가 없으면 기본값이다(위 머리말). */
export function useDrawingNoStyle(): DrawingNoStyle {
  return useContext(DrawingNoStyleContext);
}
