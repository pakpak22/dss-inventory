import { readFile } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { buildStockWorkbook, stockExportFileName, StockWorkbookError, type StockExportRow } from "@/lib/excel/stock-workbook";
import { CATEGORY_LABEL, OWNER_LABEL } from "@/lib/parts/codes";
import { selectPartsForState } from "@/lib/parts/selection";
import { todaySeoul } from "@/lib/stock/codes";

/**
 * GET /api/export/parts?<목록 주소와 같은 조건> — 재고 현황 엑셀 내려받기 (조각 6).
 *
 * 로그인한 사람이면 누구나(보기 역할도, REQUIREMENTS 3절 역할표). 바깥 시스템용 토큰 API(/api/v1)가 아니라 **세션**으로 지킨다.
 * 틀 파일은 환경변수 STOCK_DOWNLOAD_TEMPLATE_PATH 가 가리키는 곳에서 읽는다(없으면 명확히 멈춤, CLAUDE.md 12-1절 6번).
 * 🔴 실제 파일시스템에 닿는 곳은 이 readFile 하나다. 틀은 읽기만 한다.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized", message: "로그인이 필요합니다." }, { status: 401 });

  let template: Buffer;
  try {
    template = await readFile(env.stockDownloadTemplatePath);
  } catch (e) {
    console.error("[export] 내려받기 틀을 읽지 못함:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "template_unavailable", message: "내려받기 틀 파일을 읽지 못했습니다. 관리자에게 알리십시오." }, { status: 500 });
  }

  const { rows } = await selectPartsForState(request.nextUrl.searchParams, session.user.id);
  const exportRows: StockExportRow[] = rows.map((p) => ({
    no: p.no,
    name: p.name,
    name2: p.name2,
    kyosanPartNo: p.kyosanPartNo,
    drawingNo: p.drawingNo,
    quantity: p.quantity,
    supplyPrice: p.supplyPrice,
    supplyCurrency: p.supplyCurrency,
    quotePrice: p.quotePrice,
    note: p.note,
    itemName: p.itemName,
    categoryLabel: CATEGORY_LABEL[p.category],
    ownerLabel: OWNER_LABEL[p.owner],
  }));

  let bytes: Buffer;
  try {
    bytes = buildStockWorkbook(template, exportRows);
  } catch (e) {
    if (e instanceof StockWorkbookError) return NextResponse.json({ error: "export_failed", message: e.message }, { status: 500 });
    throw e;
  }

  const name = stockExportFileName(todaySeoul());
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.ascii}"; filename*=UTF-8''${encodeURIComponent(name.utf8)}`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
