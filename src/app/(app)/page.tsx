import { Suspense } from "react";
import { EMPTY_DETAIL, type PartDetailData } from "@/components/parts/PartDetailDialog";
import { PartsList } from "@/components/parts/PartsList";
import { roleAtLeast } from "@/lib/auth/role";
import { getSession } from "@/lib/auth/session";
import { getTransitionDate, legacyHistory, partProducts, partYearly, usageByMonth, yearlyUsageAll } from "@/lib/legacy/queries";
import { currentMonthSeoul } from "@/lib/parts/frequent";
import { listFavoritePartIds } from "@/lib/parts/favorites";
import { listPartItems, listParts } from "@/lib/parts/queries";
import { partHistory } from "@/lib/stock/queries";

/**
 * 재고 현황 목록 `/` — 첫 화면 (DESIGN 2-1절).
 *
 * 서버에서 부품 전체와 항목 목록을 읽어 클라이언트 조각(PartsList)에 넘긴다. 찾기·거르기·정렬은 거기서.
 * `?part=No.` 가 있으면(상세 창) 그 부품의 수량 이력·과거 기록·연도별 수량·사용된 제품도 함께 읽어 내려준다 — 창은 클라이언트지만 자료는 서버에서.
 * 연도별 사용 수량(목록의 연도 칸)과 전환일은 항상 읽는다 — 부품 319개 × 연도 몇 개라 작다.
 * 레이아웃이 이미 requireSession 을 거쳤고, cache() 덕에 getSession 은 DB 를 다시 읽지 않는다.
 *
 * useSearchParams 를 쓰는 클라이언트 조각은 Suspense 로 감싼다 (Next 16 문서 use-search-params).
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ part?: string | string[] }> }) {
  const sp = await searchParams;
  const partRaw = Array.isArray(sp.part) ? sp.part[0] : sp.part;
  const partNo = partRaw && /^\d+$/.test(partRaw) ? Number(partRaw) : null;

  const [session, rows, items, yearly, transition, monthly] = await Promise.all([getSession(), listParts(), listPartItems(), yearlyUsageAll(), getTransitionDate(), usageByMonth()]);
  const role = session?.user.role ?? "VIEWER";
  const favorites = session ? await listFavoritePartIds(session.user.id) : [];
  let detail: PartDetailData = EMPTY_DETAIL;
  if (partNo !== null) {
    const p = rows.find((r) => r.no === partNo);
    if (p) {
      const [history, legacy, py, products] = await Promise.all([partHistory(p.id), legacyHistory(p.id), partYearly(p.id), partProducts(p.id)]);
      detail = { history, legacy, yearly: py.rows, excludedLegacy: py.excludedLegacy, products };
    }
  }

  return (
    <Suspense fallback={<div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">불러오는 중입니다.</div>}>
      <PartsList
        rows={rows}
        items={items}
        detail={detail}
        yearly={yearly}
        transitionDate={transition?.value ?? null}
        favorites={favorites}
        monthly={monthly}
        thisMonth={currentMonthSeoul()}
        canRegister={roleAtLeast(role, "ADMIN")}
        canRecord={roleAtLeast(role, "STAFF")}
      />
    </Suspense>
  );
}
