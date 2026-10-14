/**
 * 실행 환경 값. 전부 환경변수에서 온다 (CLAUDE.md 12-1절 6번).
 *
 * 🔴 없으면 조용히 기본값으로 넘어가지 않고 **명확히 던진다.**
 *    인증·DB 에서 "설정이 빠졌는데 그럭저럭 동작하는" 상태가 가장 위험하기 때문이다.
 *
 * 다만 `next build` 는 환경변수 없이 돌아야 하므로(컨테이너 빌드 때 .env 가 없다)
 * 값을 **모듈을 불러올 때가 아니라 실제로 쓸 때** 읽는다. 그래서 전부 getter 다.
 */

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new Error(`환경변수 ${name} 이(가) 비어 있습니다. .env.local 을 확인하십시오.`);
  }
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

function requiredSecret(name: string, minLength: number): string {
  const v = required(name);
  if (v.length < minLength) {
    throw new Error(`환경변수 ${name} 은(는) ${minLength}자 이상이어야 합니다.`);
  }
  return v;
}

function stripTrailingSlash(url: string): string {
  // issuer 는 끝 슬래시까지 ID 토큰의 iss 와 정확히 일치해야 한다 (CLAUDE.md 6-1·6-4절).
  // 사람이 .env 에 슬래시를 붙여도 깨지지 않게 여기서 한 번 벗긴다.
  return url.replace(/\/+$/, "");
}

/** 포털이 로그인 끝에 브라우저를 되돌려 보내는 경로. `SSO_REDIRECT_URI` 가 이 글자로 끝난다. */
export const SSO_CALLBACK_PATH = "/api/auth/sso/callback";

/**
 * 「밖에서 이 시스템에 닿는 주소」의 앞머리. 알림 줄의 링크(`href`)가 여기서 나온다.
 *
 * ── 왜 환경변수를 새로 두지 않는가 ──────────────────────────────────────
 * `SSO_REDIRECT_URI` 가 **이미 그 주소**다. 포털이 브라우저를 되돌려 보내는 곳이라
 * 정의상 밖에서 닿는 주소와 같아야 하고, 포털 등록값과 글자 단위로 같아야 로그인이
 * 된다. 값을 하나 더 두면 둘이 어긋날 수 있고, 어긋난 쪽이 알림 링크라면 증상이
 * 「다른 시스템의 종에서 누르면 엉뚱한 데로 간다」 하나뿐이라 원인을 찾기 어렵다.
 * 여기서 뽑으면 틀렸을 때 **로그인 단계에서 먼저** 드러난다.
 * (컨테이너 안에서 자기 주소를 `auto` 로 알아내면 172.x 가 나온다 — 그래서도 이 값이다.)
 *
 * 🔴 조용히 물러서지 않고 던진다. 그냥 넘어가면 알림 링크가
 * `…/api/auth/sso/callback/entries` 꼴이 되어, 눌러 보기 전까지 아무도 모른다.
 * 종 하나 때문에 모든 화면이 죽지 않게 삼키는 것은 부르는 쪽(notifications/queries.ts)의 몫이다.
 */
export function ownBaseUrlFrom(redirectUri: string): string {
  const trimmed = redirectUri.trim();
  if (!trimmed.endsWith(SSO_CALLBACK_PATH)) {
    throw new Error(`SSO_REDIRECT_URI 는 ${SSO_CALLBACK_PATH} 로 끝나야 합니다 — 이 값에서 이 시스템 자신의 주소도 읽습니다.`);
  }
  return trimmed.slice(0, -SSO_CALLBACK_PATH.length).replace(/\/+$/, "");
}

export const env = {
  /** PostgreSQL 접속 문자열. 개발은 127.0.0.1:5450 */
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },

  /** 세션 쿠키 서명 키. 바꾸면 나가 있는 세션이 전부 무효가 된다. */
  get authSessionSecret(): string {
    return requiredSecret("AUTH_SESSION_SECRET", 32);
  },

  /** 로그인 왕복 쿠키(code_verifier·state·nonce) 서명 키. 🔴 세션 키와 달라야 한다. */
  get ssoTxSecret(): string {
    const v = requiredSecret("SSO_TX_SECRET", 32);
    if (v === process.env.AUTH_SESSION_SECRET) {
      throw new Error("SSO_TX_SECRET 은 AUTH_SESSION_SECRET 과 다른 값이어야 합니다.");
    }
    return v;
  },

  /** HTTPS 뒤에서만 true. 사내망 HTTP 에서 true 면 쿠키가 저장되지 않아 로그인이 조용히 실패한다. */
  get sessionCookieSecure(): boolean {
    return optional("SESSION_COOKIE_SECURE", "false").toLowerCase() === "true";
  },

  /** 세션 수명(시간). 포털 SSO 절대 만료 12시간을 넘기지 않는다. */
  get sessionHours(): number {
    const n = Number(optional("SESSION_HOURS", "12"));
    if (!Number.isFinite(n) || n <= 0 || n > 12) {
      throw new Error("SESSION_HOURS 는 1 이상 12 이하의 숫자여야 합니다 (포털 세션 절대 만료가 12시간).");
    }
    return n;
  },

  /** 포털(dss-auth) issuer. 끝 슬래시 없음. 개발은 담당자 PC http://192.168.1.132:3100 */
  get ssoIssuer(): string {
    return stripTrailingSlash(required("SSO_ISSUER"));
  },

  get ssoClientId(): string {
    return required("SSO_CLIENT_ID");
  },

  /** 🔴 서버에서만 쓴다. NEXT_PUBLIC_ 접두사를 붙이지 않는다. */
  get ssoClientSecret(): string {
    return required("SSO_CLIENT_SECRET");
  },

  /** 포털 등록값과 글자 단위로 같아야 한다. */
  get ssoRedirectUri(): string {
    return required("SSO_REDIRECT_URI");
  },

  /**
   * 밖에서 이 시스템에 닿는 주소의 앞머리(예: `http://192.168.1.132:3800`). 끝 슬래시 없음.
   * 알림 줄의 링크가 여기서 나온다 — 그 줄은 다른 시스템의 종에도 실리므로 **절대 주소**여야 한다.
   * 🔴 별도 환경변수를 두지 않는 까닭은 위 `ownBaseUrlFrom` 머리말에.
   */
  get ownBaseUrl(): string {
    return ownBaseUrlFrom(env.ssoRedirectUri);
  },

  /**
   * A/S 인수번호 조회 통로 (DESIGN 7절). 담당자가 주는 주소. `{number}` 자리표시자가 있으면 거기에, 없으면 끝에 붙인다.
   * 🔴 비어 있으면 「응답 없음」으로 다룬다(저장은 되고 확인 안 됨 표시). 다른 값과 달리 없어도 서버가 뜬다 — 통로가 없는 동안에도 반출 기록은 받아야 한다.
   */
  get asLookupUrl(): string | null {
    const v = optional("AS_LOOKUP_URL", "");
    return v === "" ? null : v;
  },
  get asLookupToken(): string | null {
    const v = optional("AS_LOOKUP_TOKEN", "");
    return v === "" ? null : v;
  },

  /**
   * A/S 가 내주는 읽기 전용 통로 묶음의 앞머리(예: `http://…/api/v1`). 끝 슬래시는 붙여도 된다.
   * 승인 절차(결재선) 화면이 여기에 `/users` 를 붙여 **사람 명부**를 받아 온다 — 결재자가 A/S 의
   * 사람이기 때문이다(2026-10-15 사용자 결정). 토큰은 `AS_LOOKUP_TOKEN` 을 그대로 쓴다.
   *
   * 🔴 비어 있어도 서버는 뜬다. 그때 명부는 「못 받아 왔다」가 되고, 화면은 저장된 결재선을
   * 그대로 보여 주되 **「없는 사람」이라고 말하지 않는다**(`src/lib/approval/directory.ts`).
   */
  get asApiBaseUrl(): string | null {
    const v = optional("AS_API_BASE_URL", "");
    return v === "" ? null : v;
  },

  /**
   * 다른 사내 시스템(A/S·PO)이 이 시스템의 읽기 전용 API(/api/v1/…)를 부를 때 내는 공유 토큰. 32자 이상.
   * 비어 있으면 API 가 503 으로 닫힌다 — 서버는 뜬다(화면은 토큰과 무관).
   */
  /**
   * 🔴 개발 전용 「역할 바꿔 보기」. 자체 로그인·가계정은 만들지 않으므로(CLAUDE.md 5절), 관리자가 자기 세션의 역할을
   * **낮춰** 보는 것으로 기록 역할 화면을 시험한다. 운영(NODE_ENV=production)에서는 값이 있어도 꺼진다.
   */
  get devRoleOverride(): boolean {
    return process.env.NODE_ENV !== "production" && optional("DEV_ROLE_OVERRIDE", "false").toLowerCase() === "true";
  },

  /** 재고 현황 내려받기 틀(.xlsx). 프로그램은 읽기만 한다 (조각 6, DESIGN 6-1절). 없으면 내려받기가 명확히 실패한다. */
  get stockDownloadTemplatePath(): string {
    return required("STOCK_DOWNLOAD_TEMPLATE_PATH");
  },

  /** 데이터 폴더(틀·한 벌·치워 둔 파일·백업). 실제 파일시스템에 닿는 곳에서만 쓴다 (CLAUDE.md 12-1절). */
  get inventoryDataDir(): string {
    return required("INVENTORY_DATA_DIR");
  },
  /** 한 벌 틀(.xlsx, 과거 줄 2,314줄 값째). 프로그램은 읽기만 한다 (조각 7, DESIGN 6-1절). */
  get stockWorkbookTemplatePath(): string {
    return required("STOCK_WORKBOOK_TEMPLATE_PATH");
  },
  /** 한 벌 결과물(.xlsx). 프로그램이 통째로 바꿔 쓴다. 사람이 손대면 옆으로 치우고 멈춘다 (REQUIREMENTS 6절). */
  get stockWorkbookPath(): string {
    return required("STOCK_WORKBOOK_PATH");
  },
  /**
   * 사람이 탐색기로 원본 한 벌을 찾아가는 경로(예: \NAS\공유\재고\재고 및 견적 현황판.xlsx). 화면 표시 전용 (2026-10-07 사용자 요청).
   * NAS 에서는 서버 안의 경로(STOCK_WORKBOOK_PATH, 컨테이너 안)와 사람이 보는 공유 폴더 경로가 달라서 따로 둔다. 비어 있으면 서버 경로를 보인다.
   */
  get stockWorkbookSharePath(): string {
    return optional("STOCK_WORKBOOK_SHARE_PATH", "") || required("STOCK_WORKBOOK_PATH");
  },

  get inventoryApiToken(): string | null {
    const v = optional("INVENTORY_API_TOKEN", "");
    if (v === "") return null;
    if (v.length < 32) throw new Error("INVENTORY_API_TOKEN 은 32자 이상이어야 합니다.");
    return v;
  },
} as const;

/**
 * 서버가 뜰 때 한 번 호출해 빠진 값을 한꺼번에 알려 준다.
 * (instrumentation.ts 에서 부른다. 빌드 때는 부르지 않는다.)
 */
export function assertEnvOnStartup(): void {
  const problems: string[] = [];
  const checks: Array<[string, () => unknown]> = [
    ["DATABASE_URL", () => env.databaseUrl],
    ["AUTH_SESSION_SECRET", () => env.authSessionSecret],
    ["SSO_TX_SECRET", () => env.ssoTxSecret],
    ["SESSION_HOURS", () => env.sessionHours],
    ["SSO_ISSUER", () => env.ssoIssuer],
    ["SSO_CLIENT_ID", () => env.ssoClientId],
    ["SSO_CLIENT_SECRET", () => env.ssoClientSecret],
    ["SSO_REDIRECT_URI", () => env.ssoRedirectUri],
    // 조각 6·7: 엑셀 틀·한 벌·데이터 폴더. 없으면 내려받기·자동 갱신이 첫 요청이 아니라 시작할 때 멈춘다.
    ["STOCK_DOWNLOAD_TEMPLATE_PATH", () => env.stockDownloadTemplatePath],
    ["INVENTORY_DATA_DIR", () => env.inventoryDataDir],
    ["STOCK_WORKBOOK_TEMPLATE_PATH", () => env.stockWorkbookTemplatePath],
    ["STOCK_WORKBOOK_PATH", () => env.stockWorkbookPath],
  ];
  for (const [, check] of checks) {
    try {
      check();
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (problems.length > 0) {
    throw new Error(`환경 설정이 빠졌습니다:\n- ${problems.join("\n- ")}`);
  }
}
