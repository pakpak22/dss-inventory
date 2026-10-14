import { ApprovalRouteSection, type ApprovalRoutesByScope } from "@/components/settings/ApprovalRouteSection";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { fetchAsUserDirectory } from "@/lib/approval/as-users";
import { getCurrentApprovalRoute } from "@/lib/approval/queries";
import { APPROVAL_ROUTE_SCOPES } from "@/lib/approval/route";
import { requireRole } from "@/lib/auth/session";

/**
 * 설정 — 승인 절차 `/settings/approval-routes` (관리자, 조각 ③b).
 *
 * 🔴 **화면이 숨기는 것은 편의일 뿐 차단이 아니다.** 여기서 역할을 보고, 저장하는 서버 액션이
 * 자기 자리에서 **다시** 본다(`src/app/actions/approval-routes.ts`).
 *
 * 🔴 용도 목록을 **돌면서** 판을 읽는다. 용도를 하나 더하면 빠진 자리가 컴파일러에 보인다
 * (`ApprovalRoutesByScope` 가 Record 인 까닭).
 *
 * 🔴 A/S 사람 명부는 **여기서 한 번** 받아 와 화면에 내려보낸다. 못 받아 왔으면 그 사실까지
 * 그대로 내려간다 — 「한 명도 없다」로 바꿔 보내면 화면이 저장된 결재선을 전부 「명부에 없는
 * 사람」으로 그린다(`src/lib/approval/directory.ts` 머리말).
 */
export const metadata = { title: "승인 절차" };

export default async function ApprovalRoutesSettingsPage() {
  await requireRole("ADMIN", "/settings/approval-routes");

  const routes = {} as ApprovalRoutesByScope;
  for (const scope of APPROVAL_ROUTE_SCOPES) {
    routes[scope] = await getCurrentApprovalRoute(scope);
  }
  const directory = await fetchAsUserDirectory();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">
        설정 <span className="font-normal text-zinc-500">· 승인 절차</span>
      </h1>
      <SettingsNav current="approval" />

      <ApprovalRouteSection routes={routes} directory={directory} />
    </div>
  );
}
