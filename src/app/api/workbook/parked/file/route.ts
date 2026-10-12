import { NextResponse } from "next/server";
import { roleAtLeast } from "@/lib/auth/role";
import { getSession } from "@/lib/auth/session";
import { readParkedFile } from "@/lib/excel/workbook-sync";

/**
 * GET /api/workbook/parked/file — 치워 둔 파일(사람이 손댄 엑셀)을 그대로 내려준다 (관리자, 조각 8-A).
 * 파일 이름은 상태 표(`workbook_states.parked_file`)에 적힌 것만 쓴다 — 쿼리로 임의 경로를 받지 않는다(경로 조작 방지).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !roleAtLeast(session.user.role, "ADMIN")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parked = await readParkedFile();
  if (!parked) return NextResponse.json({ error: "not_found", message: "수기입 파일이 없습니다." }, { status: 404 });
  return new NextResponse(new Uint8Array(parked.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="parked.xlsx"; filename*=UTF-8''${encodeURIComponent(parked.name)}`,
      "Content-Length": String(parked.bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
