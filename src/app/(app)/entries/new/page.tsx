import { EntryForm } from "@/components/stock/EntryForm";
import { roleAtLeast } from "@/lib/auth/role";
import { requireRole } from "@/lib/auth/session";
import { listParts } from "@/lib/parts/queries";
import { isRecordableType, todaySeoul, type RecordableType } from "@/lib/stock/codes";
import { returnCandidates } from "@/lib/stock/queries";

/**
 * 수량 변경 기록 `/entries/new` (기록·관리자, DESIGN 2-4절). 휴대폰에서도 쓴다.
 * `?type=USE&part=165` 로 상세 창의 [반출][입고] 에서 들어온다. 반환은 `rpart=No.` 로 되돌릴 줄을 가져온다.
 */
export const metadata = { title: "수량 변경 기록" };

export default async function NewEntryPage({ searchParams }: { searchParams: Promise<{ type?: string; part?: string; rpart?: string }> }) {
  const sp = await searchParams;
  const session = await requireRole("STAFF", `/entries/new${sp.type ? `?type=${sp.type}` : ""}`);
  const isAdmin = roleAtLeast(session.user.role, "ADMIN");
  let type: RecordableType = isRecordableType(sp.type) ? sp.type : "USE";
  if (!isAdmin && (type === "ADJUST" || type === "TRANSFER")) type = "USE";
  const partNo = /^\d+$/.test(sp.part ?? "") ? Number(sp.part) : null;
  const rpartNo = /^\d+$/.test(sp.rpart ?? "") ? Number(sp.rpart) : null;

  const parts = await listParts();
  const rpart = rpartNo === null ? null : parts.find((p) => p.no === rpartNo) ?? null;
  const candidates = type === "RETURN" && rpart ? await returnCandidates(rpart.id) : [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">수량 변경 기록</h1>
      <EntryForm
        key={`${type}-${partNo ?? ""}-${rpartNo ?? ""}`}
        parts={parts}
        initialType={type}
        initialPartNo={partNo}
        isAdmin={isAdmin}
        today={todaySeoul()}
        returnCandidates={candidates}
        returnPartNo={rpart ? rpart.no : null}
      />
    </div>
  );
}
