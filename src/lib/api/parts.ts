import type { Category, Currency, Owner } from "@/db/schema/codes";
import { resolveOverhaulUnitPrice } from "@/lib/oh/unit-price";
import { CATEGORY_LABEL, OWNER_LABEL, isCategory, isOwner } from "@/lib/parts/codes";

/**
 * 바깥(A/S·PO)에 내주는 부품 한 줄의 모양 — **현황판 12칸 그대로** + 고객사 품명 + 코드값과 한글을 함께.
 *
 * 🔴 이 모양은 다른 시스템이 의존하는 약속이다. 칸을 **더하는 것**은 괜찮지만 이름을 바꾸거나 빼면 저쪽이 깨진다.
 *    바꿔야 하면 `v2` 를 새로 열고 담당자와 날짜를 정한다. 설명은 저장소의 API.md.
 *
 * - 부품을 가리키는 값은 `no`(No., 바뀌지 않는다). UUID 는 내주지 않는다.
 * - 없는 값은 글자 칸이면 "" , 금액이면 null. 엑셀의 `-` 는 쓰지 않는다.
 */
export interface ApiPart {
  no: number;
  name: string;
  name2: string;
  /**
   * 고객사에 나가는 서류(견적서 등)에 쓰는 이름. 우리 품명(`name`)과 다르다. 없으면 "".
   * 🔴 엑셀 한 벌에는 안 나가는 칸이다 — 여기(API)와 화면에만 있다. 2026-10-14 에 더했다.
   */
  customerName: string;
  kyosanPartNo: string;
  drawingNo: string;
  quantity: number;
  supplyPrice: number | null;
  /** JPY | KRW */
  supplyCurrency: Currency;
  /** 항상 원 */
  quotePrice: number | null;
  /**
   * **오버홀(O/H) 작업일 때의 견적가.** 일반 수리면 `quotePrice`, O/H 면 이 값을 쓴다
   * (A/S 의 부품 고르개가 고르는 순간 단가를 붓는 자리다). 2026-10-16 에 더했다.
   *
   * ── 🔴 2026-10-22 오후부터 **이미 풀린 값**이다 (쓰는 분 결정) ──────────
   * 저장된 O/H 단가가 없는 부품은 이제 **그 부품의 `quotePrice` 가 실려 나간다** —
   * 「비워 두면 견적가가 자동으로 쓰이고, 견적가가 바뀌면 따라 바뀐다」가 그 결정이다.
   * 푸는 일은 `resolveOverhaulUnitPrice` **한 함수**가 하고(`src/lib/oh/unit-price.ts`),
   * 🔴 **받는 쪽은 아무것도 안 고친다** — 같은 폴백을 두 시스템이 각자 계산하면 언젠가 서로
   * 다른 값을 말한다. 값을 **복사해 두지도 않는다**: DB 의 빈 값은 빈 채로 남고, 읽을 때마다
   * 그때의 견적가로 다시 풀린다.
   * 🔴 그 전(2026-10-16~10-22 오전)에는 **정한 부품만 값이 있고 나머지는 `null`** 이었다.
   *    지금 `null` 은 「O/H 단가도 견적가도 둘 다 없다」는 뜻이다 — 뜻이 좁아졌을 뿐이라 받는
   *    쪽이 하던 일(「`null` 이면 칸을 비우고 사람이 채운다」)은 그대로 맞다.
   *
   * 🔴 **`0` 은 「O/H 때는 무상」이고 `null` 과 섞지 않는다.** 받는 쪽은 `?? 0` 으로 뭉개지
   *    말고(정하지 않은 부품이 0원으로 청구된다), `|| null` 도 쓰지 말라(무상이 뒤집힌다).
   *    (까닭은 `db/schema/oh-templates.ts` 의 `part_overhaul_unit_prices` 머리말)
   * 🔵 **통화 칸을 두지 않는다** — `quotePrice` 와 같이 **항상 원**이다. 통화가 갈리는 것은
   *    공급가(`supplyPrice`·`supplyCurrency`)뿐이다.
   * 🔵 **「사람이 정한 값인가 / 견적가를 따른 것인가」를 말해 주는 칸은 두지 않았다**(2026-10-22).
   *    받는 쪽(A/S 견적서)이 그 갈림으로 하는 일이 하나도 없고 — 어느 쪽이든 똑같이 단가 칸에
   *    붓는다 — 쓰이지 않는 칸을 내주면 그 뒤로는 아무도 안 지키는 약속이 하나 는다.
   *    🔵 그 갈림이 보여야 하는 자리는 **값을 정하는 화면**뿐이고, 그 화면은 재고관리 안에 있어
   *    두 숫자를 이미 다 쥐고 있다(`overhaulUnitPriceFollowsQuote`). 필요해지면 그때 칸을
   *    더하면 된다 — 더하는 것은 깨지 않는 변경이다(위 머리말).
   */
  overhaulQuotePrice: number | null;
  note: string;
  item: { code: string; name: string };
  category: { code: Category; label: string };
  owner: { code: Owner; label: string };
  /** ISO 8601 (UTC). 이 시각 뒤에 바뀐 것만 받으려면 ?since= 에 넣는다 */
  updatedAt: string;
}

export interface ApiPartSource {
  no: number;
  name: string;
  name2: string;
  customerName: string;
  kyosanPartNo: string;
  drawingNo: string;
  quantity: number;
  supplyPrice: number | null;
  supplyCurrency: Currency;
  quotePrice: number | null;
  /**
   * 🔴 **DB 에 저장돼 있는 값 그대로다**(`part_overhaul_unit_prices.unit_price`, 행이 없으면
   * `null`). 내보내는 `ApiPart.overhaulQuotePrice` 와 **이름이 일부러 다르다** — 저쪽은 견적가를
   * 섞어 **푼 값**이고 이쪽은 **안 푼 값**이라, 같은 이름이면 `toApiPart` 가 그냥 복사하는 칸으로
   * 보여 다음 사람이 푸는 줄을 지운다(2026-10-22 에 이름을 갈랐다).
   * 🔴 0 으로 채우지 않는다 — `0` 은 「무상」이다(위 `ApiPart.overhaulQuotePrice`).
   */
  overhaulUnitPrice: number | null;
  note: string;
  itemCode: string;
  itemName: string;
  category: Category;
  owner: Owner;
  updatedAt: Date;
}

export function toApiPart(p: ApiPartSource): ApiPart {
  return {
    no: p.no,
    name: p.name,
    name2: p.name2,
    customerName: p.customerName,
    kyosanPartNo: p.kyosanPartNo,
    drawingNo: p.drawingNo,
    quantity: p.quantity,
    supplyPrice: p.supplyPrice,
    supplyCurrency: p.supplyCurrency,
    quotePrice: p.quotePrice,
    // 🔴 **여기서 푼다 — 받는 쪽이 아니라.** 저장된 O/H 단가가 없으면 「견적가를 따른다」는
    //    뜻이므로 `quotePrice` 가 나간다(2026-10-22 쓰는 분 결정, 위 칸 머리말).
    //    🔴 직접 `?? `·`||` 를 적지 말고 **그 한 함수**를 부른다 — `||` 로 적으면 무상(`0`)이
    //    견적가로 둔갑하고, 두 곳에 각자 적으면 언젠가 서로 다른 값을 말한다.
    overhaulQuotePrice: resolveOverhaulUnitPrice(p.overhaulUnitPrice, p.quotePrice),
    note: p.note,
    item: { code: p.itemCode, name: p.itemName },
    category: { code: p.category, label: CATEGORY_LABEL[p.category] },
    owner: { code: p.owner, label: OWNER_LABEL[p.owner] },
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** 목록 API 의 검색 조건 (주소의 쿼리). 모르는 값은 400 으로 돌려준다 — 조용히 전체를 주면 저쪽이 모른다. */
export interface ApiPartsFilter {
  owner: Owner | null;
  category: Category | null;
  item: string | null;
  q: string;
  since: Date | null;
}

export type ParseFilterResult = { ok: true; filter: ApiPartsFilter } | { ok: false; error: string };

export function parseApiPartsFilter(sp: URLSearchParams): ParseFilterResult {
  const owner = sp.get("owner");
  const category = sp.get("category");
  const item = sp.get("item");
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const sinceRaw = sp.get("since");
  if (owner !== null && owner !== "" && !isOwner(owner)) return { ok: false, error: `owner 는 DSS | KYOSAN | SERVICE_SPARE 중 하나입니다 (받은 값: ${owner})` };
  if (category !== null && category !== "" && !isCategory(category)) return { ok: false, error: `category 는 RFG | MB | COMPATIBLE 중 하나입니다 (받은 값: ${category})` };
  if (item !== null && item !== "" && !/^[A-Z][A-Z0-9_]{0,39}$/.test(item)) return { ok: false, error: "item 은 항목 코드(영문 대문자)입니다" };
  let since: Date | null = null;
  if (sinceRaw) {
    since = new Date(sinceRaw);
    if (Number.isNaN(since.getTime())) return { ok: false, error: "since 는 ISO 8601 시각입니다 (예: 2026-10-06T00:00:00Z)" };
  }
  return { ok: true, filter: { owner: owner && isOwner(owner) ? owner : null, category: category && isCategory(category) ? category : null, item: item || null, q, since } };
}

/** 찾기: 품명·품명2·고객사 품명·교산 품번·도번에 낱말이 모두 들어 있는 것 (화면 찾기와 같은 규칙) */
export function matchesQuery(p: Pick<ApiPartSource, "name" | "name2" | "customerName" | "kyosanPartNo" | "drawingNo">, q: string): boolean {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (toks.length === 0) return true;
  const hay = `${p.name} ${p.name2} ${p.customerName} ${p.kyosanPartNo} ${p.drawingNo}`.toLowerCase();
  return toks.every((t) => hay.includes(t));
}
