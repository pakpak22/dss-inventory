import { PartForm } from "@/components/parts/PartForm";
import { requireRole } from "@/lib/auth/session";
import { listPartItems } from "@/lib/parts/queries";

/**
 * 부품 등록 `/parts/new` (관리자, DESIGN 2-3절). 역할 검사는 서버에서 (CLAUDE.md 8-4절) — 액션에서도 다시 한다.
 * 처음 값: 소유 DSS·분류 RFG·통화 엔 (현황판의 다수파). 항목은 비워 두어 반드시 고르게 한다.
 */
export const metadata = { title: "부품 등록" };

export default async function NewPartPage() {
  await requireRole("ADMIN", "/parts/new");
  const items = await listPartItems();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">부품 등록</h1>
      <PartForm
        items={items}
        partId={null}
        partNo={null}
        quantity={null}
        initial={{ name: "", name2: "", customerName: "", kyosanPartNo: "", drawingNo: "", supplyPrice: "", supplyCurrency: "JPY", quotePrice: "", note: "", itemId: "", category: "RFG", owner: "DSS" }}
      />
    </div>
  );
}
