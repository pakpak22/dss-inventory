/**
 * ============================================================================
 * O/H 템플릿을 화면에 그릴 모양 — **타입만** 있는 파일
 * ============================================================================
 * `queries.ts` 는 `server-only` 라 클라이언트 조각이 끌어올 수 없고, 그렇다고 같은 모양을 화면
 * 쪽에 한 벌 더 적으면 칸이 늘 때 한쪽만 고쳐진다. 그래서 모양만 여기 두고 양쪽이 가져다 쓴다
 * (`src/lib/approval/view.ts` 와 같은 판단).
 * ============================================================================
 */

export type OhTemplateItemView = {
  id: string;
  displayOrder: number;
  /** 재고 마스터 연결. **null 이 정상이다** — 마스터에 없는 품목이 실제로 있다. */
  partId: string | null;
  /** 양식에 적혀 있던 이름 그대로. 견적서에 찍히는 값이다. */
  partNameText: string;
  quantity: number;
  /** 이어진 재고 부품의 지금 No. · 품명. 연결이 없으면 `null`. */
  partNo: number | null;
  partName: string | null;
  /**
   * 그 부품의 O/H 단가(원).
   * 🔴 **`null` 은 0 이 아니다** — 「정하지 않음」이고, 그때 견적서는 칸을 비워 두고 사람이 채운다.
   * 0 은 「오버홀 때는 무상」이라는 뜻이다. 읽는 쪽에서 `?? 0` 으로 뭉개지 마라.
   */
  ohPrice: number | null;
};

export type OhTemplateModelView = {
  /** 연결 줄 자체의 id. 연결을 풀 때 이 값을 보낸다. */
  id: string;
  /** A/S 의 `product_models.id`. */
  productModelId: string;
  /** 이을 때 떠 온 이름 사본. 정본은 언제나 A/S 다. */
  productModelName: string;
};

export type OhTemplateView = {
  id: string;
  /** 🔴 낙관적 잠금용 판 번호. 화면이 저장할 때 이 값을 그대로 돌려보낸다. */
  version: number;
  code: string;
  name: string;
  note: string | null;
  items: OhTemplateItemView[];
  models: OhTemplateModelView[];
};
