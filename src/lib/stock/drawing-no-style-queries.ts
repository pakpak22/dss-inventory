import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings, SETTING_DRAWING_NO_STYLE } from "@/db/schema/app-settings";
import { DRAWING_NO_STYLE_DEFAULT, parseDrawingNoStyle, serializeDrawingNoStyle, type DrawingNoStyle } from "./drawing-no-style";

/**
 * 도번 표시 모양 — **설정 표 한 줄을 읽고 쓰는 자리** (2026-11-20).
 *
 * 🔴 **규칙은 한 글자도 여기 없다.** 기본값도, 「깨졌으면 어떻게 하나」도 전부 순수 함수 쪽이고
 *    (`./drawing-no-style.ts`) 여기는 **글자를 꺼내 넘기고 받아 적기만** 한다. 섞으면 이 저장소에
 *    없는 「DB 가 붙은 시험」이 있어야만 그 규칙을 돌려 볼 수 있게 된다.
 * 🔵 쓰기를 **같은 파일에 두는 까닭**: 읽는 열쇠와 쓰는 열쇠가 어긋나면 **오류 없이** 「저장은
 *    되는데 화면은 그대로」가 된다. 두 줄이 나란히 있으면 그 어긋남이 눈에 보인다.
 */

export interface DrawingNoStyleSetting {
  style: DrawingNoStyle;
  /**
   * 저장된 줄이 **없거나 깨졌을 때**가 아니라, **줄 자체가 없을 때** `null` 이다.
   * 🔵 설정 화면이 「아직 한 번도 안 바꿨습니다(기본값)」를 가려 말하는 데 쓴다 — 기본값으로
   *    서 있는 화면과 누군가 기본값과 똑같이 저장해 둔 화면은 **보이기는 같지만 다른 상태**다.
   */
  savedAt: string | null;
  /** 마지막으로 바꾼 사람 이름(그때의 이름). 줄이 없으면 빈 글자다. */
  savedByName: string;
}

/** 설정 화면이 쓰는 읽기 — 값과 함께 「누가 언제」까지. */
export async function readDrawingNoStyleSetting(): Promise<DrawingNoStyleSetting> {
  const [row] = await db().select().from(appSettings).where(eq(appSettings.key, SETTING_DRAWING_NO_STYLE)).limit(1);
  if (!row) return { style: { ...DRAWING_NO_STYLE_DEFAULT }, savedAt: null, savedByName: "" };
  return { style: parseDrawingNoStyle(row.value), savedAt: row.updatedAt.toISOString(), savedByName: row.updatedByName };
}

/**
 * 화면이 그릴 모양만. 🔴 **인증 구간 레이아웃이 화면마다 부르는 자리**라(`src/app/(app)/layout.tsx`)
 * 값 하나만 돌려주고, 던지는 것도 부르는 쪽이 삼킨다 — 도번 색 하나 때문에 모든 화면이 안 뜨면 안 된다.
 */
export async function getDrawingNoStyle(): Promise<DrawingNoStyle> {
  return (await readDrawingNoStyleSetting()).style;
}

/**
 * 저장 — 줄이 없으면 만들고 있으면 덮어쓴다.
 *
 * 🔴 **감사 로그를 따로 쌓지 않는다.** 이 표에는 「누가 언제 바꿨나」 칸이 이미 셋 있고
 *    (`updated_by`·`updated_by_name`·`updated_at`) 설정 화면이 그 값을 그대로 보여 준다. 이 값은
 *    **지금 화면이 어떻게 보이나**가 전부인 꾸밈 설정이라, 지나간 판을 되짚을 일이 없다 — 되짚을
 *    일이 있는 값(결재선·단가)은 감사 로그를 쌓는다.
 * 🔵 이름을 **복사해 둔다**: 사람 이름은 포털에서 바뀐다(`audit_logs.actor_name` 과 같은 까닭).
 */
export async function saveDrawingNoStyle(style: DrawingNoStyle, actor: { id: string; name: string }): Promise<void> {
  const value = serializeDrawingNoStyle(style);
  await db()
    .insert(appSettings)
    .values({ key: SETTING_DRAWING_NO_STYLE, value, updatedBy: actor.id, updatedByName: actor.name })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date(), updatedBy: actor.id, updatedByName: actor.name },
    });
}
