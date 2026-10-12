# 재고관리 시스템이 다른 사내 시스템에 내주는 API

- 상대: A/S 관리 시스템, PO·내자(예정). **읽기 전용**입니다. 재고 쪽이 부품 목록의 주인이고(REQUIREMENTS 1절), 저쪽은 읽어 갑니다.
- 처음 연 날: 2026-10-06. 담당자(최희만)가 "API 로 가져가겠다"고 해서 열었습니다.
- 🔴 이 문서의 모양은 다른 시스템이 의존하는 **약속**입니다. 칸을 더하는 것은 괜찮지만 이름을 바꾸거나 빼지 않습니다. 바꿔야 하면 `v2` 를 새로 열고 날짜를 정합니다.

## 1. 인증

서버가 서버를 부르므로 포털 로그인이 아니라 공유 토큰입니다.

```
Authorization: Bearer <INVENTORY_API_TOKEN>
```

| 경우 | 응답 |
|---|---|
| 토큰이 맞음 | 200 |
| 토큰이 없거나 틀림 | 401 `{ "error": "unauthorized" }` |
| 재고 쪽에 토큰이 설정되지 않음 | 503 `{ "error": "api_closed" }` — 통로가 닫힌 상태 |

토큰은 재고 쪽 `.env.local`(개발) / NAS 환경변수(운영)의 `INVENTORY_API_TOKEN` 이고, 같은 값을 A/S 쪽 환경변수에 넣습니다. 32자 이상. 담당자가 만들어 양쪽에 넣습니다. 모든 응답은 `cache-control: no-store` 입니다.

주소: 개발 `http://localhost:3800`, 운영은 담당자가 정하는 `https://inventory.dss21.co.kr`(CLAUDE.md 7절).

## 2. 부품 목록 — `GET /api/v1/parts`

현황판 「부품 재고 현황」 시트와 같은 12칸을 **No. 순**으로 전부 줍니다. 숨긴(삭제) 부품은 빠집니다. 부품이 수백 개라 쪽 나누기는 없습니다.

쿼리(전부 선택):

| 이름 | 값 | 뜻 |
|---|---|---|
| `owner` | `DSS` · `KYOSAN` · `SERVICE_SPARE` | 소유 |
| `category` | `RFG` · `MB` · `COMPATIBLE` | 분류 |
| `item` | 항목 코드 (예: `PCB`, `SHEET_METAL`) | 항목. 목록은 3절 |
| `q` | 글자 | 품명·품명2·교산 품번·도번에 낱말이 **모두** 들어 있는 것 (띄어쓰기로 여러 낱말) |
| `since` | ISO 8601 시각 (예: `2026-10-06T00:00:00Z`) | 그 뒤에 바뀐 부품만. 주기적으로 맞출 때 |

모르는 값은 400 으로 돌려줍니다(조용히 전체를 주지 않습니다).

응답:

```json
{
  "generatedAt": "2026-10-06T05:12:00.000Z",
  "count": 319,
  "parts": [
    {
      "no": 165,
      "name": "AMP-DEH-DV2H(13M)",
      "name2": "",
      "kyosanPartNo": "C090722733",
      "drawingNo": "WR10136AA148B",
      "quantity": 273,
      "supplyPrice": 54000,
      "supplyCurrency": "JPY",
      "quotePrice": 990000,
      "note": "2024.04.07 재고 100EA시 주문 필요",
      "item": { "code": "PCB", "name": "PCB" },
      "category": { "code": "RFG", "label": "RFG" },
      "owner": { "code": "SERVICE_SPARE", "label": "보수부재" },
      "updatedAt": "2026-10-06T03:00:00.000Z"
    }
  ]
}
```

칸 설명:

| 칸 | 뜻 |
|---|---|
| `no` | 부품 No. **바깥에서 부품을 가리킬 때 쓰는 값.** 바뀌지 않고 다시 쓰이지 않습니다. UUID 는 내주지 않습니다 |
| `name` · `name2` | 품명 · 품명2. 없으면 `""` (엑셀의 `-` 가 아닙니다) |
| `kyosanPartNo` · `drawingNo` | 교산 품번 · 도번. 겹칠 수 있습니다. 없으면 `""` |
| `quantity` | 현재 수량(개). 재고 쪽 원장의 합 |
| `supplyPrice` · `supplyCurrency` | 공급가와 통화(`JPY` 엔 / `KRW` 원). 없으면 `null` |
| `quotePrice` | 견적가. **항상 원.** 없으면 `null`. 견적서는 이 값을 그 시점 값으로 복사해 둡니다(REQUIREMENTS 8절) |
| `note` | 비고. 줄바꿈 포함 |
| `item` · `category` · `owner` | 코드값과 화면 글자를 함께. 저장·비교는 `code`, 보여 주기는 `name`/`label` |
| `updatedAt` | 마지막으로 고친 시각(UTC). 수량만 바뀐 것은 여기 반영되지 않습니다 — 수량은 매번 읽으십시오 |

### 🔴 같은 품명이 여럿일 때 (담당자 답변3 1절)

같은 품명·품명2·도번·소유인 부품이 16묶음(32개) 있습니다(YAC사양용, 개조용, T/C用, 수리소 관리용 …). 고르개에 품명만 보이면 똑같은 줄이 둘 뜨므로 **`owner` 와 `note`(비고) 를 함께 보여 주십시오.** 구분 글자는 **비고(`note`)** 에 있고, 따로 칸을 두지 않기로 했습니다(2026-10-06 사용자 결정). 고르개에서 `note` 의 첫 줄을 품명 옆에 보여 주면 됩니다.

견적서·O/H 템플릿에 저장된 No. 의 소유는 **고를 때 딸려 들어온 값일 뿐**입니다. 그 소유를 읽어 「이 견적서는 보수부재용」 같은 판단을 하지 마십시오(답변3).

## 3. 부품 하나 — `GET /api/v1/parts/{no}`

```json
{ "part": { ...위와 같은 모양... } }
```

없거나 숨긴 부품은 404 `{ "error": "not_found" }`.

### 항목 코드 (2026-10-06 기준 19종)

`PCB` PCB · `SHEET_METAL` 판금 · `CAPACITOR` 콘덴서 · `FUSE` 퓨즈 · `SCREW` 나사 · `VVC` 바리콘 · `CABLE` 케이블 · `IGBT` IGBT · `FITTING` 피팅 · `FLOW_METER` 유량계 · `TRANSFORMER` 트랜스 · `FAN` 팬 · `CONTROLLER` 컨트롤러 · `COUPLING` 커플링 · `CONNECTOR` 커넥터 · `RESISTOR` 저항 · `HOSE` 호스 · `MOTOR` 모터 · `ETC` 기타

관리자가 항목을 더할 수 있으므로 목록을 코드에 박지 말고 응답의 `item.code` 를 그대로 쓰십시오.

## 4. 아직 열지 않은 것 — 담당자와 정할 것

### 4-1. A/S 의 부품 반출 신청 → 재고 원장 (🔴 보류 — 방향 확정 2026-10-08)

> **🔴 결정 (2026-10-08, 사용자): 신청은 A/S 에서, 승인은 재고관리에서.**
> A/S 가 우리 통로를 불러 재고관리에 **「확인 대기」 신청(`stock_requests`, status PENDING)** 을 만든다. 이때는 수량을 건드리지 않는다.
> 우리 담당자가 확인 대기 목록에서 **승인**하면 그 순간 원장(`stock_entries`/`stock_transactions`)에 떨어져 수량이 빠진다 — 이미 만든 `confirmRequest` 흐름 그대로.
> 그래서 새 통로는 원장이 아니라 **신청을 만든다**(아래 코드블록의 `POST /api/v1/entries` 가 아니라 `POST /api/v1/requests` 류). 아래 원안(A/S 승인 → 직접 원장 쓰기)은 **채택하지 않는다**(기록으로 남겨 둠).
> 여전히 **보류**(통로는 아직 안 연다). 통로를 열 때 정할 것: ① 신청 생성에도 **멱등 키**(끊겨 두 번 와도 신청 하나) ② `actor` = 신청한 사람(포털 `sub` 로 `users` 에 이음) ③ 승인·거절 결과를 A/S 가 어떻게 아는가 — 방향은 「재고관리가 통로를 열고 A/S 가 부른다」 하나뿐이므로 A/S 가 상태를 **되읽거나**, 신청자가 우리 화면에서 본다(우리가 A/S 를 부르지 않는다) ④ 인수번호 확인 시점(신청 때인가 승인 때인가). 🔴 **최희만과 맞출 것**: A/S 가 신청에 실어 보낼 값, 승인 결과를 A/S 화면에 어떻게 보일지.

A/S 에 부품 요청·승인 흐름이 이미 있습니다. 승인되어 부품이 나가면 그 사실은 재고 쪽 원장(`stock_entries`/`stock_transactions`)에 한 줄로 떨어져야 수량이 맞습니다. 길은 셋이고 담당자가 고릅니다(CLAUDE.md 2-2절 2번).

1. 신청 화면을 재고 쪽으로 옮긴다(REQUIREMENTS 7절 「나중에 붙이는 것」).
2. **A/S 가 재고 쪽 기록 통로를 부른다** — 아래 제안.
3. 당분간 신청과 별개로, 가져가는 사람이 재고 화면에서 직접 기록한다(지금 상태).

2번을 고르면 이런 모양을 제안합니다(열기 전에 담당자 확인):

```
POST /api/v1/entries
Authorization: Bearer <INVENTORY_API_TOKEN>
Content-Type: application/json

{
  "type": "USE",
  "occurredOn": "2026-10-06",
  "intakeNumber": "D260701",
  "purpose": "REPAIR",
  "actor": { "name": "홍길동", "sub": "<포털 sub>" },
  "lines": [ { "no": 165, "quantity": 1, "chargeType": "PAID", "note": "" } ]
}
→ 201 { "entry": { "sheetYear": 2026, "sheetNo": 84, "intakeUnverified": false } }
→ 409 { "error": "insufficient", "message": "No. 165 …: 수량이 모자랍니다 (지금 0개, 필요 1개)" }
```

- 수량은 재고 쪽이 잠그고 검사합니다(0 아래 거절). 인수번호는 재고 쪽이 A/S 조회 통로로 다시 확인합니다.
- 🔴 **멱등**(답변3 4절): A/S 가 보내는 `requestKey`(A/S 쪽 요청 id)를 받고, 같은 키가 두 번 오면 두 번 빼지 않고 처음 결과를 그대로 돌려줍니다. 통신이 끊기면 실제로 두 번 옵니다.
- 방향: **재고관리가 통로를 열고 A/S 가 부릅니다.** 재고관리가 A/S DB 를 건드리는 길은 없습니다.
- `actor` 는 포털 `sub` 로 재고 쪽 `users` 에 잇습니다. 재고에 없는 사람이면 이름만 남깁니다.

### 4-2. 재고 쪽이 A/S 에 묻는 것 — 인수번호 조회 통로

방향이 반대인 통로입니다(DESIGN 7절). 담당자가 주소를 주면 재고 쪽 `AS_LOOKUP_URL` 에 넣습니다. 여섯 값(인수번호·고객사·End-User·기종·S/N·L/N)을 JSON 으로 돌려주면 됩니다. 키 이름은 `src/lib/stock/intake-lookup.ts` 한 곳에서 맞춥니다.

## 5. 한 번 불러 보기

```bash
curl -H "Authorization: Bearer $INVENTORY_API_TOKEN" "http://localhost:3800/api/v1/parts?owner=DSS&q=vvc"
curl -H "Authorization: Bearer $INVENTORY_API_TOKEN" "http://localhost:3800/api/v1/parts/165"
```
