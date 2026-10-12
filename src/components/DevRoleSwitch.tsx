import { setDevRoleAction } from "@/app/actions/dev-role";
import { ROLES, type Role } from "@/db/schema/users";
import { ROLE_LABEL } from "@/lib/auth/role";

/**
 * 머리말의 개발 전용 「역할 바꿔 보기」. 레이아웃이 **개발 모드 + 진짜 역할 ADMIN** 일 때만 그린다.
 * 평범한 <form action> — 되돌아올 상태가 없는 단추라 자동 초기화 함정과 무관하다.
 */
export function DevRoleSwitch({ effectiveRole }: { effectiveRole: Role }) {
  const testing = effectiveRole !== "ADMIN";
  return (
    <form action={setDevRoleAction} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${testing ? "border-amber-300 bg-amber-50 text-amber-900" : "border-dashed border-zinc-300 text-zinc-500"}`} title="개발 전용. 운영에서는 보이지 않습니다.">
      <span>{testing ? "시험 중:" : "역할 바꿔 보기"}</span>
      <select name="role" defaultValue={effectiveRole} className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs text-zinc-900">
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100">
        적용
      </button>
    </form>
  );
}
