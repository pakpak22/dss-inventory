import Link from "next/link";
import { DeletePartForm } from "@/components/parts/DeletePartForm";
import { PartForm } from "@/components/parts/PartForm";
import { requireRole } from "@/lib/auth/session";
import { partToFormValues } from "@/lib/parts/form";
import { findPartByNo, listPartItems } from "@/lib/parts/queries";

/**
 * 부품 수정 `/parts/165/edit` (관리자, DESIGN 2-3절). 주소의 No. 로 찾는다 — 사람이 읽고 바깥에 내주는 값.
 * 없는 No. 는 Next 의 notFound() 대신 한국어 안내 화면 (CLAUDE.md 10절).
 */
export const metadata = { title: "부품 수정" };

export default async function EditPartPage({ params }: { params: Promise<{ no: string }> }) {
  const { no: noRaw } = await params;
  await requireRole("ADMIN", `/parts/${noRaw}/edit`);
  const no = Number(noRaw);
  const part = Number.isInteger(no) && no >= 1 ? await findPartByNo(no) : null;

  if (!part) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
        <p className="text-zinc-900">No. {noRaw} 부품이 없습니다.</p>
        <p className="mt-2">지워졌거나 주소가 잘못되었습니다.</p>
        <Link href="/" className="mt-4 inline-block rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
          재고 현황으로
        </Link>
      </div>
    );
  }

  const items = await listPartItems();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">
        부품 수정 <span className="font-normal text-zinc-500">No. {part.no}</span>
      </h1>
      <PartForm items={items} partId={part.id} partNo={part.no} quantity={part.quantity} initial={partToFormValues(part)} />
      <DeletePartForm partId={part.id} partNo={part.no} quantity={part.quantity} />
    </div>
  );
}
