import { OhTemplateScreen } from "@/components/settings/OhTemplateScreen";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { roleAtLeast } from "@/lib/auth/role";
import { requireSession } from "@/lib/auth/session";
import { fetchAsProductModels } from "@/lib/oh/as-product-models";
import { listOhPartOptions, listOhTemplates } from "@/lib/oh/queries";

/**
 * 설정 — O/H 부품 템플릿 `/settings/oh-templates` (**로그인한 모두**, 조각 8b).
 *
 * ── 🔴 문은 `requireSession` 이다 — 2026-10-21 사용자 결정으로 **열었다** ──
 * 그 전까지는 `requireRole("ADMIN")` 이었다. 🔴 **막는 자리가 여섯이었고 여섯을 함께 열었다**:
 * 이 화면 하나와 서버 액션 다섯(`src/app/actions/oh-templates.ts`). 하나라도 남으면 **화면은
 * 보이는데 저장이 거절되거나**, 그 반대가 된다 — **후자가 더 나쁘다**(화면에 아무 표시도 안 남는다).
 * 🔵 설정 묶음에서 모두가 쓰는 탭은 이것과 **결재권 위임** 둘뿐이고, 나머지(항목 관리 · 전환일 ·
 *    엑셀 상태 · 승인 절차 · 변경 이력)는 그대로 관리자 자리다.
 *
 * 🔵 A/S 원본은 이 화면을 재고 관리 안쪽(엔지니어도 볼 수 있는 자리)에 두고 고칠 수 없는 사람에게는
 * 「값은 보이고 입력칸만 없는」 모양으로 그렸다. 이 시스템은 그 갈래를 두지 않는다 — **여기 들어온
 * 사람은 고칠 수 있다.** 역할로 갈리는 화면이 아니게 됐으므로 「읽기 전용 모양」을 따로 그릴 일도 없다.
 *
 * 🔴 A/S 제품 모델 명부는 **여기서 한 번** 받아 와 화면에 내려보낸다. 못 받아 왔으면 그 사실까지
 * 그대로 내려간다 — 「한 개도 없다」로 바꿔 보내면 화면이 「이을 수 있는 모델이 없습니다」라고 적고,
 * 쓰는 사람은 A/S 쪽 모델이 지워진 줄 안다(`src/lib/oh/product-models.ts` 머리말).
 *
 * 🔵 고르개에서 **이미 붙은 모델을 빼는 일은 화면이 한다** — 순수 함수 둘(`linkedProductModelIds`
 * · `filterUnlinkedModels`)이고, 템플릿 목록이 다시 그려질 때 함께 따라와야 맞다.
 */
export const metadata = { title: "O/H 부품 템플릿" };

export default async function OhTemplatesSettingsPage() {
  const session = await requireSession("/settings/oh-templates");
  // 🔵 탭 줄을 가르는 값일 뿐 울타리가 아니다 — 관리자 탭의 울타리는 그 화면들의 requireRole 이다.
  const isAdmin = roleAtLeast(session.user.role, "ADMIN");

  const [templates, partOptions, directory] = await Promise.all([
    listOhTemplates(),
    listOhPartOptions(),
    fetchAsProductModels(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">
        설정 <span className="font-normal text-zinc-500">· O/H 템플릿</span>
      </h1>
      <SettingsNav current="oh" isAdmin={isAdmin} />

      <OhTemplateScreen templates={templates} partOptions={partOptions} directory={directory} />
    </div>
  );
}
