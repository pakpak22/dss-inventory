import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { roleAtLeast } from "@/lib/auth/role";
import { env } from "@/lib/env";

/**
 * GET /api/workbook/file — 엑셀 한 벌(프로그램이 마지막으로 쓴 파일)을 그대로 내려준다 (관리자, 2026-10-07 사용자: 「엑셀 여는 버튼이 없음」).
 * 한 벌은 서버(NAS) 디스크에 있어 브라우저에서 바로 열 수 없다 → 내려받아 연다. 파일은 읽기만 한다.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !roleAtLeast(session.user.role, "ADMIN")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const filePath = env.stockWorkbookPath;
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return NextResponse.json({ error: "not_found", message: "아직 현황판 엑셀이 없습니다. 수량·부품이 바뀐 뒤 1분 안에 만들어집니다." }, { status: 404 });
  }
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? "workbook.xlsx";
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="workbook.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
