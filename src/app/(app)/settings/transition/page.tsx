import { SettingsNav } from "@/components/settings/SettingsNav";
import { requireRole } from "@/lib/auth/session";
import { getTransitionDate } from "@/lib/legacy/queries";

/**
 * 설정 — 전환일 `/settings/transition` (관리자, DESIGN 2-7절). **보기만** 한다.
 *
 * 전환일은 실제 자료를 넣는 날 가져오기 스크립트(`npm run db:import -- --real …`)가 적어 넣는다. 화면에서 고치는 단추를
 * 두지 않는 이유: 이 값이 바뀌면 「전환일 이전/이후」 구역이 통째로 움직이는데, 자료를 넣은 날짜는 사실이지 설정이 아니다.
 * 날짜를 코드에 적지 않는다 (DESIGN 10-3절 7번).
 */
export const metadata = { title: "전환일" };

export default async function TransitionSettingsPage() {
  await requireRole("ADMIN", "/settings/transition");
  const t = await getTransitionDate();
  const isDemo = t !== null && t.updatedByName.includes("데모");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">
        설정 <span className="font-normal text-zinc-500">· 전환일</span>
      </h1>
      <SettingsNav current="transition" />

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        {t === null ? (
          <>
            <p className="text-base font-semibold text-zinc-900">전환 전</p>
            <p className="mt-1 text-sm text-zinc-600">아직 실제 자료(부품 319개·과거 기록)를 넣지 않았습니다. 상세 창의 「전환일 이전」 구역은 비어 보입니다.</p>
          </>
        ) : (
          <>
            <p className="text-base font-semibold text-zinc-900">
              전환일 <span className="tabular">{t.value}</span>
              {isDemo ? <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">데모 값</span> : null}
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              적은 것: {t.updatedByName || "-"} · <span className="tabular">{new Date(t.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })}</span>
            </p>
          </>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
        <h2 className="text-sm font-semibold text-zinc-900">전환일이 하는 일</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>부품 상세 창의 이력을 「전환일 이후 — 이 프로그램에 쌓인 기록」과 「전환일 이전 — 엑셀에서 가져온 과거 기록(참고용)」으로 가릅니다.</li>
          <li>실제 자료를 넣는 날 가져오기 명령이 적어 넣습니다. 여기서 손으로 바꾸는 단추는 없습니다.</li>
          <li>과거 기록은 수량 계산에 쓰지 않습니다. 연도별 사용 수량에는 확인된 과거 기록만 더합니다.</li>
        </ul>
      </section>
    </div>
  );
}
