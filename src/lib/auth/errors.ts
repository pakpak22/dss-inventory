/**
 * 로그인 실패 코드 → 한국어 문구 (CLAUDE.md 9-6절: 에러 코드 → 한국어 문구 표를 상수로).
 *
 * `/login?error=<code>` 로만 사용자에게 보인다. 영어 개발자 메시지·원시 예외는 절대 화면에 내지 않는다 (10절).
 * 자세한 원인은 서버 로그와 감사 로그에만 남긴다.
 */
export const LOGIN_ERROR_CODES = [
  "state_mismatch", // 돌아온 state 가 쿠키의 것과 다름 (CSRF 의심 또는 쿠키 만료)
  "tx_expired", // 로그인 왕복 쿠키가 없거나 10분이 지남
  "portal_denied", // 포털이 error 파라미터를 돌려줌 (접근 허가 없음 등)
  "token_exchange_failed", // /api/oidc/token 이 200 이 아님
  "invalid_id_token", // 서명·iss·aud·nonce·sub 검증 실패
  "unknown_role", // 포털이 보낸 역할이 VIEWER/STAFF/ADMIN 이 아님 → REJECT
  "no_role", // 처음 들어왔는데 역할 지정이 없음 (담당자가 명단에 넣어야 함)
  "portal_unreachable", // 포털 discovery/token 서버에 닿지 않음 (담당자 PC 꺼짐·주소 바뀜)
  "account_disabled", // 이 시스템에서 삭제(소프트) 처리된 사용자
  "server_error", // 그 밖의 서버 오류
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  state_mismatch: "로그인 요청이 올바르지 않습니다. 다시 로그인해 주십시오.",
  tx_expired: "로그인 시간이 지났습니다. 다시 로그인해 주십시오.",
  portal_denied: "통합 로그인에서 접근이 거절되었습니다. 이 시스템 사용 권한이 없으면 담당자(최희만)에게 요청하십시오.",
  token_exchange_failed: "통합 로그인 서버와의 확인에 실패했습니다. 잠시 뒤 다시 시도하십시오.",
  invalid_id_token: "통합 로그인 정보를 확인할 수 없습니다. 다시 로그인해 주십시오.",
  unknown_role: "이 시스템에 등록되지 않은 역할입니다. 담당자(최희만)에게 역할 확인을 요청하십시오.",
  no_role: "이 시스템의 역할이 아직 지정되지 않았습니다. 담당자(최희만)에게 요청하십시오.",
  portal_unreachable: "통합 로그인 서버에 연결할 수 없습니다. 담당자(최희만)에게 알려 주십시오.",
  account_disabled: "이 시스템에서 사용이 중지된 계정입니다. 관리자에게 문의하십시오.",
  server_error: "로그인 처리 중 오류가 났습니다. 잠시 뒤 다시 시도하십시오.",
};

export function isLoginErrorCode(v: unknown): v is LoginErrorCode {
  return typeof v === "string" && (LOGIN_ERROR_CODES as readonly string[]).includes(v);
}
