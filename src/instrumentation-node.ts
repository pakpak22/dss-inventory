/**
 * instrumentation.ts 의 node 런타임 본문. 🔴 instrumentation.ts 의 `if (NEXT_RUNTIME === "nodejs")` 블록에서만 import 한다
 * (edge 컴파일에 node:crypto 등이 끌려 들어가지 않게). 하는 일은 instrumentation.ts 머리 주석 참고.
 */
export async function registerNode(): Promise<void> {
  const { assertEnvOnStartup } = await import("@/lib/env");
  assertEnvOnStartup();
  console.log(`[dss-inventory] 환경 확인 완료. issuer=${process.env.SSO_ISSUER} port=${process.env.PORT ?? "3800"}`);

  if (process.env.WORKBOOK_SYNC_DISABLED === "1") {
    console.log("[workbook] 자동 갱신 꺼짐 (WORKBOOK_SYNC_DISABLED=1)");
    return;
  }
  const g = globalThis as unknown as { __dssWorkbookTimer?: ReturnType<typeof setInterval> };
  if (g.__dssWorkbookTimer) return;
  const { runWorkbookSync, SYNC_DELAY_MS } = await import("@/lib/excel/workbook-sync");
  const tick = async () => {
    try {
      const r = await runWorkbookSync();
      if (r.outcome === "written") console.log(`[workbook] 한 벌 씀: ${r.size.toLocaleString("ko-KR")}B, 부품 ${r.rows.parts}·사용 ${r.rows.use}·입고 ${r.rows.receive}·변경 ${r.rows.change}줄`);
      else if (r.outcome !== "skipped") console.warn(`[workbook] ${r.outcome}: ${"message" in r ? r.message : r.parkedFile}`);
    } catch (e) {
      console.error("[workbook] 자동 갱신 오류:", e instanceof Error ? e.message : e);
    }
  };
  // 켜진 직후 한 번(서버가 꺼져 있던 동안 쌓인 표시), 그 뒤 1분마다
  setTimeout(tick, 15_000).unref();
  g.__dssWorkbookTimer = setInterval(tick, SYNC_DELAY_MS);
  g.__dssWorkbookTimer.unref();
  console.log("[workbook] 엑셀 한 벌 자동 갱신 켜짐 (1분 주기)");
}
