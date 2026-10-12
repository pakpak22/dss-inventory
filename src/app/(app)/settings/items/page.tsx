import { movePartItemAction } from "@/app/actions/part-items";
import { PartItemAddForm } from "@/components/settings/PartItemAddForm";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { requireRole } from "@/lib/auth/session";
import { listPartItemsForAdmin } from "@/lib/parts/queries";

/**
 * 설정 — 항목 관리 `/settings/items` (관리자, DESIGN 2-7절). 추가와 차례.
 * 차례 바꾸기는 평범한 <form action> 이라 스크립트가 늦게 붙어도 눌린다.
 * 전환일은 `/settings/transition`(조각 5), 엑셀 상태는 조각 7 에서 이 설정 묶음에 더해진다. 길잡이는 SettingsNav.
 */
export const metadata = { title: "항목 관리" };

const SMALL_BTN = "rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40";

export default async function PartItemsSettingsPage() {
  await requireRole("ADMIN", "/settings/items");
  const items = await listPartItemsForAdmin();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">
        설정 <span className="font-normal text-zinc-500">· 항목 관리</span>
      </h1>
      <SettingsNav current="items" />

      <section className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">항목 {items.length}종</h2>
          <p className="mt-1 text-xs text-zinc-500">차례는 등록 화면과 필터 상자에 나오는 순서입니다. 이름과 코드는 바꾸지 않습니다 — 엑셀 가져오기·쓰기가 이 글자로 대조합니다.</p>
        </div>
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">아직 등록된 항목이 없습니다. 아래에서 추가하십시오.</div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-xs text-zinc-500">
                <th className="border-b border-zinc-200 px-2.5 py-2 font-medium">차례</th>
                <th className="border-b border-zinc-200 px-2.5 py-2 font-medium">이름</th>
                <th className="border-b border-zinc-200 px-2.5 py-2 font-medium">코드</th>
                <th className="border-b border-zinc-200 px-2.5 py-2 text-right font-medium">부품 수</th>
                <th className="border-b border-zinc-200 px-2.5 py-2 font-medium">옮기기</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="tabular px-2.5 py-1.5 text-zinc-500">{i + 1}</td>
                  <td className="px-2.5 py-1.5 font-medium text-zinc-900">{it.name}</td>
                  <td className="px-2.5 py-1.5 font-mono text-xs">{it.code}</td>
                  <td className="tabular px-2.5 py-1.5 text-right">{it.partCount.toLocaleString("ko-KR")}</td>
                  <td className="px-2.5 py-1.5">
                    <div className="flex gap-1">
                      <form action={movePartItemAction}>
                        <input type="hidden" name="id" value={it.id} />
                        <input type="hidden" name="dir" value="up" />
                        <button type="submit" className={SMALL_BTN} disabled={i === 0} aria-label={`${it.name} 위로`}>
                          위로
                        </button>
                      </form>
                      <form action={movePartItemAction}>
                        <input type="hidden" name="id" value={it.id} />
                        <input type="hidden" name="dir" value="down" />
                        <button type="submit" className={SMALL_BTN} disabled={i === items.length - 1} aria-label={`${it.name} 아래로`}>
                          아래로
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <PartItemAddForm />
    </div>
  );
}
