import Link from "next/link";

/**
 * 역할이 모자랄 때 (requireRole). Next 의 forbidden() 은 아직 experimental(authInterrupts) 이라 쓰지 않고
 * 평범한 화면으로 둔다.
 */
export default function ForbiddenPage() {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
      <p className="text-zinc-900">이 화면을 볼 수 있는 역할이 아닙니다.</p>
      <p className="mt-2">필요하면 담당자(최희만)에게 역할 변경을 요청하십시오.</p>
      <Link href="/" className="mt-4 inline-block rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
        재고 현황으로
      </Link>
    </div>
  );
}
