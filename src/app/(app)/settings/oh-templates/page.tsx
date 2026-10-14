import { OhTemplateScreen } from "@/components/settings/OhTemplateScreen";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { requireRole } from "@/lib/auth/session";
import { fetchAsProductModels } from "@/lib/oh/as-product-models";
import { listOhPartOptions, listOhTemplates } from "@/lib/oh/queries";

/**
 * 설정 — O/H 부품 템플릿 `/settings/oh-templates` (관리자, 조각 8b).
 *
 * 🔴 **화면이 숨기는 것은 편의일 뿐 차단이 아니다.** 여기서 역할을 보고, 저장하는 서버 액션이
 * 자기 자리에서 **다시** 본다(`src/app/actions/oh-templates.ts` 의 `requireRole("ADMIN")`).
 *
 * 🔵 A/S 원본은 이 화면을 재고 관리 안쪽(엔지니어도 볼 수 있는 자리)에 두고 고칠 수 없는 사람에게는
 * 「값은 보이고 입력칸만 없는」 모양으로 그렸다. 이 시스템에서는 **설정 묶음**에 두므로 그 갈래가
 * 없다 — 설정은 통째로 관리자 자리다(항목 관리 · 전환일 · 엑셀 상태 · 승인 절차와 같다).
 *
 * 🔴 A/S 제품 모델 명부는 **여기서 한 번** 받아 와 화면에 내려보낸다. 못 받아 왔으면 그 사실까지
 * 그대로 내려간다 — 「한 개도 없다」로 바꿔 보내면 화면이 「이을 수 있는 모델이 없습니다」라고 적고,
 * 관리자는 A/S 쪽 모델이 지워진 줄 안다(`src/lib/oh/product-models.ts` 머리말).
 *
 * 🔵 고르개에서 **이미 붙은 모델을 빼는 일은 화면이 한다** — 순수 함수 둘(`linkedProductModelIds`
 * · `filterUnlinkedModels`)이고, 템플릿 목록이 다시 그려질 때 함께 따라와야 맞다.
 */
export const metadata = { title: "O/H 부품 템플릿" };

export default async function OhTemplatesSettingsPage() {
  await requireRole("ADMIN", "/settings/oh-templates");

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
      <SettingsNav current="oh" />

      <OhTemplateScreen templates={templates} partOptions={partOptions} directory={directory} />
    </div>
  );
}
