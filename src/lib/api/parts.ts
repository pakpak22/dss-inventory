import type { Category, Currency, Owner } from "@/db/schema/codes";
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
   * 🔴 **`null` 은 「정하지 않았다」이고, `0` 은 「O/H 때는 무상」이다 — 섞지 않는다.**
   *    `null` 을 0 으로 바꿔 보내면 고르개가 **0원을 부어** 정하지 않은 부품을 0원으로 청구한다.
   *    받는 쪽도 `?? 0` 으로 뭉개지 말고, `null` 이면 칸을 **비워 두고 사람이 채우게** 한다.
   *    (까닭은 `db/schema/oh-templates.ts` 의 `part_overhaul_unit_prices` 머리말)
   * 🔵 **통화 칸을 두지 않는다** — `quotePrice` 와 같이 **항상 원**이다. 통화가 갈리는 것은
   *    공급가(`supplyPrice`·`supplyCurrency`)뿐이다.
   * 🔵 O/H 단가를 **정한 부품만** 값이 있다. 지운 단가는 행이 통째로 사라지므로 `null` 로 온다
   *    — 그 표에는 소프트 삭제가 없다(비우면 0 을 저장하지 않고 행을 지운다).
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
  /** 🔴 정해진 것만. 없으면 `null` 이고 **0 으로 채우지 않는다**(위 `ApiPart.overhaulQuotePrice`) */
  overhaulQuotePrice: number | null;
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
    // 🔴 그대로 나른다. `?? 0` · `|| null` 을 끼우지 않는다 — 앞엣것은 「정하지 않음」을 0원으로,
    //    뒤엣것은 「무상(0)」을 「정하지 않음」으로 바꿔 버린다. 둘 다 되돌릴 수 없는 손실이다.
    overhaulQuotePrice: p.overhaulQuotePrice,
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
