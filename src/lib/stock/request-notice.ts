import { ENTRY_TYPE_LABEL, isEntryType } from "@/lib/stock/codes";

/**
 * 부품 요청 단추를 누르고 **돌아온 자리에서 할 한 줄** (2026-10-15, 조각 10c).
 *
 * 단추를 누르면 누른 자리로 돌아온다(`return-to.ts` 머리말). 아무 말이 없으면 눌렀는데 아무 일도 안 난 것처럼
 * 보인다. 🔴 **두 화면이 이 한 벌을 쓴다**: 단추가 붙은 부품 요청 관리(`/requests`)와, 적힌 기록이 쌓이는
 * 기록 내역(`/entries`) — 저기로는 [기록 취소]의 결과와, 돌아갈 자리를 잃었을 때의 기본값이 떨어진다
 * (2026-10-15 로 기록 내역의 「확인 대기」 구역이 없어진 뒤로도 그렇다).
 *
 * 🔵 **문구는 여기 한 벌만 둔다.** 두 화면에 손으로 두 벌 적으면 한쪽만 고쳐지는 날이 온다.
 *    화면마다 **가리키는 자리가 다른 말**(「어느 목록에 남아 있나」·「어느 [확인]을 누르나」)만
 *    화면 이름으로 갈라 두고, 왜 다른지는 그 표에 적는다.
 * 🔵 모양(테두리·색)은 화면이 정한다 — 여기서는 **뜻**(`tone`)만 돌려준다. 클래스 글자를 lib 에 두면
 *    Tailwind 가 긁는 자리와 어긋날 수 있어 그 저장소 관례(화면 파일에 클래스)를 따른다.
 */
export type RequestNoticeScreen = "entries" | "requests";

/** `info` = 평범한 알림(회색), `warn` = 아직 끝나지 않은 것이 있음(주황). */
export interface RequestNotice {
  tone: "info" | "warn";
  text: string;
}

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): boolean => v === "1";
const text = (v: string | string[] | undefined): string | null => (typeof v === "string" ? v : null);

/**
 * 「그 신청이 아직 남아 있는 목록」을 가리키는 말.
 * 🔴 **2026-10-15 로 가리키는 곳이 하나가 됐다** — 기록 내역 맨 위의 「확인 대기」 구역을 걷어내서, 아직 안 끝난
 *    신청이 보이는 자리는 부품 요청 관리(`/requests`)뿐이다. 그 화면에서는 「이 목록」, 기록 내역에서는 **그 화면
 *    이름을 불러** 가리킨다.
 * 🔵 기록 내역에 이 말이 뜨는 길은 하나 남아 있다 — 폼의 돌아갈 자리가 없거나 깨져 서버가 기본값(`/entries`)으로
 *    떨어뜨린 때다(`return-to.ts`). 그때 「확인 대기 목록」이라고 말하면 **거기 없는 구역**을 가리키게 된다.
 */
const STILL_IN: Record<RequestNoticeScreen, string> = {
  entries: "부품 요청 관리 목록",
  requests: "이 목록",
};

/**
 * 인수번호가 확인 안 됐을 때 덧붙이는 말.
 * 🔴 **뜻이 갈린다**: 다시 묻는 [확인] 단추는 **기록 내역의 그 줄에만** 있다(`ReverifyButton`).
 *    부품 요청 관리에는 그 단추가 없으므로 같은 글자로 「아래 [확인]을 누르십시오」라고 하면 거짓말이 된다.
 */
const UNVERIFIED: Record<RequestNoticeScreen, string> = {
  entries: " A/S 가 응답하지 않아 「인수번호 확인 안 됨」으로 남았습니다. 나중에 아래 [확인]을 누르십시오.",
  requests: " A/S 가 응답하지 않아 「인수번호 확인 안 됨」으로 남았습니다. 기록 내역에서 그 줄의 [확인]을 누르십시오.",
};

/**
 * 반려·마감·보류·보류 해제·신청 취소의 결과 한 줄. 해당하는 꼬리표가 없으면 `null`.
 * (서버 액션이 한 번에 하나만 붙이므로 둘이 겹칠 일은 없다 — 겹치면 위에서부터 하나만 보인다.)
 */
export function requestDecisionNotice(sp: Params, screen: RequestNoticeScreen): RequestNotice | null {
  if (one(sp.rejected)) return { tone: "info", text: "신청을 반려했습니다." };
  if (one(sp.closed)) return { tone: "info", text: "남은 수량을 마감했습니다. 이미 나간 기록과 수량은 그대로입니다." };
  if (one(sp.held)) {
    return {
      tone: "info",
      text: `신청을 보류했습니다. 보류를 풀기 전에는 확인·반려·마감이 되지 않습니다. 신청은 ${STILL_IN[screen]}에 그대로 남고, 머리말의 「대기」 숫자에서만 빠집니다.`,
    };
  }
  if (one(sp.holdReleased)) return { tone: "info", text: "보류를 풀었습니다. 멈추기 전 자리로 돌아갔습니다." };
  if (one(sp.cancelled)) return { tone: "info", text: "신청을 취소했습니다." };
  return null;
}

/**
 * [확인]으로 **실제 기록이 적힌** 뒤의 한 줄 — 어떤 번호로 저장됐는지, 아직 남은 것이 있는지,
 * 인수번호가 확인 안 됐는지. `saved` 꼬리표가 없으면 `null`.
 *
 * 🔴 주소로 온 값이라 숫자가 아니면 0 으로 본다(사람이 주소를 고쳐도 화면이 깨지지 않게).
 */
export function requestSavedNotice(sp: Params, screen: RequestNoticeScreen): RequestNotice | null {
  const saved = text(sp.saved);
  if (saved === null) return null;
  const type = isEntryType(sp.type) ? sp.type : "USE";
  const remainingText = text(sp.remaining);
  const remaining = remainingText !== null && /^\d+$/.test(remainingText) ? Number(remainingText) : 0;
  const unverified = one(sp.unverified);
  const left = remaining > 0 ? ` 아직 ${remaining.toLocaleString("ko-KR")}개가 남았습니다. 이 신청은 ${STILL_IN[screen]}에 그대로 있습니다.` : "";
  return {
    tone: unverified || remaining > 0 ? "warn" : "info",
    text: `${ENTRY_TYPE_LABEL[type]} 기록 ${saved} 이(가) 저장되었습니다.${left}${unverified ? UNVERIFIED[screen] : ""}`,
  };
}
