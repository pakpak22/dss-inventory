import { CATEGORIES, CURRENCIES, OWNERS, type Category, type Currency, type Owner } from "@/db/schema/codes";

/**
 * 코드값 → 화면 글자 (DESIGN 4-1절). **저장은 영문 코드, 화면은 한글.**
 * 소유의 화면 표시는 지금 엑셀 표기(KYOSAN)를 따랐다. A/S 는 같은 값을 「교산」으로 보여 준다.
 * 🔴 용어를 섞어 쓰지 않는다 — 화면 전체가 이 표 하나를 쓴다 (CLAUDE.md 10절).
 */
export const OWNER_LABEL: Record<Owner, string> = {
  DSS: "DSS",
  KYOSAN: "KYOSAN",
  SERVICE_SPARE: "보수부재",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  RFG: "RFG",
  MB: "MB",
  COMPATIBLE: "호환",
};

export const CURRENCY_SIGN: Record<Currency, string> = {
  JPY: "¥",
  KRW: "₩",
};

export { OWNERS, CATEGORIES, CURRENCIES };
export type { Owner, Category, Currency };

export function isOwner(v: unknown): v is Owner {
  return typeof v === "string" && (OWNERS as readonly string[]).includes(v);
}
export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

/** 금액 표시. null 은 "-". 통화 기호를 앞에 붙인다 (예시 화면과 같다). */
export function formatMoney(value: number | null, currency: Currency): string {
  if (value === null) return "-";
  return `${CURRENCY_SIGN[currency]}${value.toLocaleString("ko-KR")}`;
}

/** 수량 표시. 단위 "개" 는 칸 머리글에만 쓴다. */
export function formatQuantity(value: number): string {
  return value.toLocaleString("ko-KR");
}

/**
 * 재고가 한계수량에 걸렸나 — 🔴 **이 부등호가 적힌 유일한 자리**다 (2026-10-16).
 *
 * ── 🔴 「이하」다. 같을 때도 알린다 ─────────────────────────────────────
 * **재고 ≤ 한계수량이면 참**이다(2026-10-16 사용자 결정). 처음에는 「미만」(같으면 안 알림)으로
 * 만들었다가 같은 날 사용자가 **「같을 때도 알린다」**로 정해 바꿨다. 뜻은 「한계수량까지
 * 내려왔으면 이미 채울 때다」이다.
 *
 * ── 🔴 끄는 길은 **비우는 것(`null`) 하나뿐**이다 ───────────────────────
 * `limit` 이 `null`(정하지 않음)이면 **언제나 거짓**이다 — 그 부품은 알림 대상이 아니다.
 * 🔴 **`0` 으로 두는 것은 끄는 길이 아니다.** 부등호가 「이하」라서 재고가 0 이면 `0 <= 0` 으로
 *    **울린다**(= 「하나도 안 남으면 알려라」). 부등호가 「미만」이던 잠깐 동안에는 0 이 사실상
 *    끄는 값이었는데, 지금은 **아니다.** 끄려면 칸을 비워야 한다.
 * 🔴 그래서 `?? 0` 으로 뭉개면 안 된다 — 정하지 않은 부품이 **재고 0 이 되는 순간 전부** 울린다.
 *
 * ── 🔵 적는 자리를 하나로 둔 까닭 ───────────────────────────────────────
 * **알림 줄**(`lib/notifications/bell-items.ts`의 조립)과 **상세 창의 「부족」 딱지**
 * (`components/parts/PartDetailDialog.tsx`)와 **질의의 WHERE**(`lib/parts/queries.ts`의
 * `listLowStockParts`)가 이 함수 하나를 본다. 손으로 두 벌 적으면 「상세엔 부족이라는데 종은
 * 조용하다」가 생긴다. 🔵 이 파일에 둔 까닭: 세 자리 중 하나가 **클라이언트 조각**이라
 * 서버 전용 모듈에 둘 수 없고, 애초에 부품 어휘(`formatQuantity` 옆)가 제자리다.
 */
export function isLowStock(quantity: number, limit: number | null): boolean {
  if (limit === null) return false;
  return quantity <= limit;
}

/**
 * 「왜 빨간가」를 말해 주는 한 줄 — 수량 칸에 마우스를 올리면 뜬다 (2026-10-16).
 *
 * 🔴 **색만으로 알리지 않는다.** 재고 현황 목록에서 한계수량에 걸린 부품은 수량 글자가 붉어지는데,
 * 색을 못 가리는 사람에게는 **아무 표시도 없는 것과 같다.** 그래서 같은 사실을 글자로도 단다 —
 * 부품 요청 관리의 「가용」 칸이 모자랄 때 빨강 + `title` 을 함께 다는 것과 **같은 결**이다
 * (`components/stock/RequestManagerScreen.tsx`).
 *
 * 🔴 **판정을 여기서 다시 적지 않는다** — 바로 위 `isLowStock` 을 그대로 부른다. 걸리지 않으면
 * `undefined` 라, 부르는 쪽이 조건을 한 번 더 쓰지 않아도 된다(`title={lowStockTitle(…)}` 한 줄).
 * 🔵 `limit === null` 을 먼저 보는 것은 **부등호가 아니라 타입 좁히기**다(글자에 넣어야 해서).
 */
export function lowStockTitle(quantity: number, limit: number | null): string | undefined {
  if (limit === null || !isLowStock(quantity, limit)) return undefined;
  return `한계수량 ${formatQuantity(limit)}개 이하입니다. 지금 재고 ${formatQuantity(quantity)}개 — 채워 넣을 때입니다.`;
}
