import { redirect } from "next/navigation";
import { isLoginErrorCode, LOGIN_ERROR_MESSAGES } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";

/**
 * 로그인 화면 (CLAUDE.md 9-6절). 🔴 아이디/비밀번호 입력란이 없다.
 *
 * 보호된 화면은 세션이 없으면 곧장 /api/auth/sso/start 로 가므로, 이 화면은
 * **거절 사유를 보여줄 때**와 **로그아웃 직후**에만 쓰인다. 여기서 자동으로 다시 보내지 않는다 — 무한 왕복이 된다.
 * 사람이 [로그인] 을 눌러야 다시 간다.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; info?: string | string[]; returnTo?: string | string[] }>;
}) {
  const sp = await searchParams;
  const error = first(sp.error);
  const info = first(sp.info);

  // 이미 로그인되어 있으면 볼 이유가 없다 (방금 로그아웃한 경우는 쿠키가 지워져 여기 안 걸린다).
  if (!error && !info && (await getSession())) redirect("/");

  const message = isLoginErrorCode(error) ? LOGIN_ERROR_MESSAGES[error] : error ? LOGIN_ERROR_MESSAGES.server_error : null;
  const startHref = `/api/auth/sso/start?returnTo=${encodeURIComponent(first(sp.returnTo) ?? "/")}`;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-zinc-900">재고 관리</h1>
        <p className="mt-1 text-sm text-zinc-500">DSS 통합 로그인으로 들어갑니다.</p>

        {message && (
          <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {message}
          </p>
        )}
        {info === "logged_out" && (
          <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">로그아웃되었습니다.</p>
        )}

        <a
          href={startHref}
          className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          로그인
        </a>
        <p className="mt-3 text-xs text-zinc-500">
          로그인 화면이 뜨지 않거나 어제까지 되던 로그인만 막히면 담당자(최희만)에게 알려 주십시오.
        </p>
      </div>
    </main>
  );
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
