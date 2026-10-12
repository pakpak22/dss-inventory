-- 손으로 쓴 마이그레이션 (drizzle-kit generate --custom). 표 구조는 바꾸지 않고 **주석(COMMENT)** 만 단다.
-- 담당자 요청(답변서 2026-10-02 3-1절): 원장의 quantity_before / quantity_after 는 그 시점의 표시용이지 진실이 아니다.
COMMENT ON COLUMN "stock_transactions"."quantity_before" IS '그 시점의 표시용 값(엑셀 「현 재고」 칸). 재고를 다시 계산하는 데 쓰면 안 된다. 진실은 delta 의 합이다. 바로잡기가 쌓이면 과거 줄의 이 값과 실제 수량이 달라진다.';--> statement-breakpoint
COMMENT ON COLUMN "stock_transactions"."quantity_after" IS '그 시점의 표시용 값(엑셀 「이후 재고」 칸). 재고를 다시 계산하는 데 쓰면 안 된다. 진실은 delta 의 합이다.';--> statement-breakpoint
COMMENT ON COLUMN "stock_transactions"."delta" IS '수량 증감. 이 칸의 합이 현재 수량의 진실이다. 줄은 고치지도 지우지도 않는다 — 되돌리는 줄(CORRECTION)을 새로 쌓는다.';--> statement-breakpoint
COMMENT ON COLUMN "stock_entries"."sheet_no" IS '엑셀 No. 칸의 연도별·시트별 순번. 바로잡아도 다시 매기지 않는다 — 빈 번호가 생기는 것이 맞다.';
