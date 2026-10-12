# DSS 재고관리 시스템 (dss-inventory) — 프로젝트 규칙과 현황 (항상 적용)

**한 줄 설명**: 부품 재고·입고·사용 기록을 관리하는 사내 웹 시스템. DSS 통합 로그인 포털(`dss-auth`) 뒤에 붙는
다섯 번째 사내 시스템이고, 여기 들어가는 재고 목록과 수량이 **회사의 정본**이 된다. 엑셀 현황판은 프로그램이 한 벌을 항상 최신으로 다시 쓴다.

이 문서에서 **「사용자」**는 눈앞에서 대화하는 동료(정영빈)이고, **「담당자」**는 사내 시스템 전체를 관리하는 최희만이다.
담당자에게 물어야 할 것은 사용자가 대신 답할 수 없다 — **적어 두었다가 함께 전달한다.**

## 0. 문서와 현황 — 이것부터 읽는다

| 문서 | 내용 |
|---|---|
| `REQUIREMENTS.md` | 요구 사항. 인터뷰(2026-10-01~02) 결과와 담당자 답으로 확정된 것. 10·11절에 담당자 답과 남은 것 |
| `DESIGN.md` | 화면 흐름·자료 구조·엑셀·조각 7단계. **담당자 승인(2026-10-02 자, 10-06 전달)**. 10절에 승인 답변으로 보탠 것 |
| `README.md` | 시작하는 방법(짧게) |
| `답변_2026-10-02.md`, `받은자료/답변2_2026-10-02.md`, `받은자료/포털등록값_2026-10-06.md` | 담당자가 보낸 원문 (git 에 넣지 않음) |

### 지금 어디까지 됐나 (2026-10-07)

- ✅ **(10-12 저녁) 실자료 전환 준비 시작 — 추천 순서(사용자 「ㄱㄱ」): ① git 첫 커밋 `1c7bcdf`(198 파일, `.env.local`·받은자료 제외) ② `docs/전환일_절차서_2026-10-12.md`(전제 7·NAS 폴더/환경변수 표·전날/당일 10단계·숫자 대조 SQL·되돌리기·담당자 요청문 6절) ③ 원격 저장소 `https://github.com/pakpak22/dss-inventory`(비공개, 사용자 계정 pakpak22, origin/main, kiri190-me 에 쓰기 초대 보냄 — 수락 대기).** 인계 묶음은 바탕화면 `재고관리 인계 (2026-10-12)` 폴더(데이터 폴더의 `templates`·`import` 둘만 + 문서 + 부품 319 열쇠 목록 xlsx). 고객사 제출용 품명은 A/S 쪽 수작업(재고 관리에 넣지 않음, 열쇠 = No.). 고친 것: Dockerfile `tools` 단계가 `src/db`·`env.ts` 만 담아 NAS 에서 가져오기·자체 점검이 모듈을 못 찾을 상태 → `src` 전체 + `tsconfig.json`(🔴 이 PC 에서 docker build 안 돌려 봄 — 메모리. NAS 첫 빌드 때 `--check-only` 로 확인). 🔴 **자동 모드가 `git remote add`·`git push` 를 막는다** → 사용자가 입력창에 `! cd /c/Users/정영빈/dss-inventory && git push` 로 직접(역슬래시 경로는 bash 가 먹음). **다음 = 담당자 답(백업 확인·운영 환경변수·초대 수락) 대기. 그 사이: 현황판 최신 사본으로 `--check-only` 재검사.**
- ✅ **(10-12 오후) 8-B 화면 확인 끝 — 사용자가 멈춤 상태(`현황판_사람수정_20261012-1308.xlsx`, 사용 1·입고 1·조정 1 + 반영 불가 2)에서 [엑셀 기준 적용 준비] → [원장에 적기] 실제로 눌러 3건 적음(US-2026-10·RC-2026-3·CH-2026-10).** 지적 하나 고침: 변경 이력(`/audit`)에 `WORKBOOK_EXCEL_APPLIED` 상세가 JSON 그대로 보였다 → `linesOf` 에 엑셀 행위 셋(멈춤·엑셀 기준 적용·가져오기) 글자 규칙 추가, 대상 `workbook` → 「엑셀 한 벌」, 적용 때 감사 detail 에 **기록 번호 `entryNos`** 도 남김(uuid 는 사람에게 뜻이 없음). 번호 없는 옛 기록은 `entryNosByIds`(stock/queries.ts)로 볼 때 찾음(감사 로그는 append-only 라 고쳐 넣지 않음). **함정**: 사람이 엑셀만 고치면 1분 주기는 「쓸 것 없음(dirty 아님)」으로 지나간다 — 프로그램에 새 기록이 생기거나 [지금 쓰기](또는 `workbook:selftest`)를 눌러야 알아챈다(설계대로, `runWorkbookSync` 199행). **다음 = 실자료 전환 준비.**
- ✅ **(10-12 오후) 조각 8-B [엑셀 기준 적용] 끝 — 코드·0008 적용·테스트·실제 치워 둔 파일로 끝까지 검증.** 승인: 사용자가 `npm run db:migrate` 를 보냄(계획 10절 다섯 가지 전부 추천안). **사용자 화면 확인 대기**: 멈춤 상태에서 `/settings/workbook` 의 [엑셀 기준 적용 준비] → `/settings/workbook/apply`(적을 기록·수량 맞춤·반영 불가 줄·사유·확인 체크·[원장에 적기]) → 돌아와 녹색 안내. 지금 DB 는 OK(멈춤 아님)라 화면을 보려면 원본 엑셀을 고쳐 멈추게 해야 한다(「8-B 화면 보여 줘」).
  - 만든 것: `src/lib/excel/workbook-apply.ts`(순수 `planApply`·`summarizePlan`, 테스트 `tests/workbook-apply.test.ts` 9개) · `workbook-apply-run.ts`(`readParkedPlan`·`applyExcel`: 조언 잠금 LOCK_KEY → PARKED·파일 이름 확인 → sha 중복 확인 → `recordEntryIn` N건 → `workbook_apply_logs` → 상태 OK → 감사 `WORKBOOK_EXCEL_APPLIED`, 한 트랜잭션) · `ledger.ts` 의 `recordEntryIn(tx, …)` 분리(+`LedgerAbort`·`LedgerTx` export, recordEntry 동작 같음) · 표 `workbook_apply_logs`(0008, sha256 UNIQUE) · `/settings/workbook/apply` + `WorkbookApplyView` + `applyExcelAction`(평범한 form action, 성공·실패 모두 redirect) · 설정 화면 [엑셀 기준 적용 준비] 단추·`?applied=N` 녹색 안내 · `npm run workbook:parked-diff -- --plan`(react-server 조건으로 바꿈).
  - 실측(개발 DB): 사용처 1줄·입고 1줄·변경 2줄(조정·반환) 더하고 부품 수량 둘·비고 하나 고침 → 계획 = 사용 1·입고 1·조정 1·조정(수량 맞춤) 1, 반영 불가 2(반환·비고) → 잘못된 지문·빈 사유 거절 → 적용 4건(USE-2026-9·RECEIVE-2026-2·CHANGE-2026-8·9), 수량 24/28/70, 로그·감사 한 줄, 상태 OK → 같은 지문 재적용은 not_parked 로 거절 → 다음 차례에 한 벌 다시 씀(174,021B, 사용 11·입고 2·변경 9). tsc·eslint·테스트 210개(207 통과·3 건너뜀) 통과.
  - 함정: ① `return skip(...)` 꼴을 쓰려면 skip 이 void 를 돌려줘야 한다(push 의 number 가 섞여 tsc 가 깨짐). ② 조정의 날짜는 순수 함수가 모르므로(오늘) 실행 쪽이 채운다 — 지문은 빈 날짜로 계산해 양쪽이 같다. ③ `-- --plan` 처럼 ledger 를 끌어오는 스크립트는 `node --conditions=react-server --import tsx` 로.
  - 다음: 실자료 전환 준비(담당자 백업 확인·NAS 환경변수·`--real`), 담당자에게 표 범위 함수 보여 주기, A/S 신청 통로(보류).
- ✅ **(10-12) 8-A 화면 확인 끝 — 사용자 「확인 다 됨」.** [프로그램 기준 적용] 11:31:03 → 11:31:45 한 벌 다시 씀(173,285B, 부품 84·사용 10·입고 1·변경 7줄), 상태 OK. 멈춤→차이 표시→해제→재작성 한 바퀴 실측 완료. **다음 = 8-B 계획(`docs/조각8B_계획_2026-10-12.md`) 승인 → 착수.**
- 🔴 **(10-12 오전 기록) 사용자 할 일 둘이었음: ① 8-A 화면 확인(끝) ② 8-B 계획 승인(대기).**
  - ① 개발 서버가 떠 있고(`localhost:3800`) DB 는 **PARKED** 상태다 — 원본 수량 한 칸(No. 1 예시 PCB-001, 18→19)을 고쳐 멈추게 해 두었다. `/settings/workbook` 에서 노란 띠·「사람이 손댄 내용」(바뀐 1줄: No. 1 수량 18 → 19)·[프로그램 기준 적용]·[치워 둔 파일 내려받기]·백업 안내·폴더 링크를 보면 된다. 확인 뒤 [프로그램 기준 적용]을 누르면 다음 차례에 한 벌을 다시 쓴다. 서버가 내려갔으면 「서버 띄워」(Docker Desktop 먼저).
  - ② **`docs/조각8B_계획_2026-10-12.md`** — [엑셀 기준 적용] 계획. 정할 것 다섯(10절, 추천안 있음). 「계획대로」면 추천안으로 착수. 마이그레이션 0008(적용 기록 표) 승인은 `npm run db:migrate` 보내는 방식.
  - 10-12 에 한 것: (a) 개발 서버가 모든 페이지 500 — `instrumentation.ts` 의 `node:crypto` edge 컴파일 문제 고침(아래 함정). (b) 8-A 서버 쪽 동작 끝까지 검증: 파일 고침 → 1분 뒤 PARKED + 치워 둠 + 감사 로그 → `readParkedDiff` 로 차이 읽기. (c) **8-A 버그 고침**: 프로그램이 쓴 비고는 CRLF, 엑셀이 저장하면 LF 라 손대지 않은 여러 줄 비고 19줄이 전부 「바뀜」으로 잡혔다 → `workbook-diff.ts` `normalizeText`(CRLF·CR·`_x000D_` → LF) + 테스트 1개. 고친 뒤 차이 = 1줄(기대대로). (d) `npm run workbook:parked-diff`(`scripts/workbook-parked-diff.ts`): 치워 둔 파일 차이를 터미널에 찍는 운영 점검 명령(DB 읽기만). tsc·eslint·build·테스트 201개(198 통과·3 건너뜀) 통과.

- 🔴 **10-08 마감. 내일 첫 일 = 조각 8-A 화면 확인**(사용자: 「8-A 확인부터, 내일」). 서버가 밤새 메모리로 내려갔으면 「서버 띄워」 → `localhost:3800` 로그인 → `/settings/workbook`: ① 백업 안내·[월별 폴더]·[일일 폴더] 링크 ② 원본 엑셀을 한 칸 고쳐 저장하고 1분 뒤 멈춤 상태의 **차이 화면**(바뀐 줄·[프로그램 기준 적용]·[치워 둔 파일 내려받기]) 확인. 확인되면 **조각 8-B([엑셀 기준 적용], 2단계 관리자 승인→원장) 계획** 올리고 착수. 10-08 에 한 것: 조각 8-A(차이 보기+프로그램 기준 적용+치워 둔 파일 내려받기), 백업 둘(일일 30일·월별 영구 OLD) + 설정 화면 안내·폴더 링크, 자체 점검 `npm run workbook:selftest`(네 파일 통과 확인). A/S 연동 방향 확정(신청 A/S·승인 재고관리, 보류). 엑셀 직접수정 동작 = 2번+두 단추.

- 🔴 **(10-08) A/S(최희만 ERP) 연동 방향 확정: 신청은 A/S 에서, 승인은 재고관리에서.** A/S 가 우리 통로를 불러 **「확인 대기」 신청**(`stock_requests` PENDING, 수량 안 건드림)을 만들고, 우리 담당자가 승인하면 그때 원장에 떨어져 수량이 빠진다(이미 만든 `confirmRequest` 그대로). 새 통로는 원장이 아니라 **신청을 만든다**(원안 4-1 「A/S 승인 → 직접 원장 쓰기」는 폐기). 여전히 **보류**(통로 미개설). `API.md` 4-1절에 적음. 정할 것: 신청 생성 멱등 키·actor 매핑·승인 결과를 A/S 가 어떻게 아는지·인수번호 확인 시점. 🔴 최희만과 맞출 것: A/S 가 신청에 실어 보낼 값, 결과 화면.
- 🔴 **(10-08) 엑셀 직접 수정 동작 결정 = 2번 + 두 단추(엑셀 기준 / 프로그램 기준, 엑셀 기준은 관리자 승인 관문).** `docs/엑셀_직접수정시_동작_2026-10-07.md` 끝에 적음. 조각 8 은 **두 단계로 나눔**(엑셀 기준 적용은 정본 원장에 쓰므로 차이를 먼저 믿을 수 있게).
  - ✅ **조각 8-A 끝(10-08): 치워 둔 파일 vs 프로그램 기준본 차이를 화면에 보여 주기 + [프로그램 기준 적용] + [치워 둔 파일 내려받기].** 원장에 안 씀. 쓸 때마다 같은 바이트를 `INVENTORY_DATA_DIR/baseline/<파일명>` 에 그림자로 둔다(`writeBaseline`, 실패해도 본 쓰기는 성공). 비교는 **값으로**(바이트 아님, 열어 저장만 해도 바이트는 바뀜), 기준본과 견준다(DB 로 다시 만들면 그 사이 변경이 섞임). 줄 맞춤: 부품 재고 현황 = **No.**, 나머지 셋 = **줄 번호**(끝에 붙은 줄 = 사람이 더함). 칸 이름은 파일 머리글(1행)에서 읽음. `src/lib/excel/workbook-diff.ts`(순수, `diffWorkbooks`) + `workbook-sync.ts` 의 `readParkedDiff`·`readParkedFile`, `GET /api/workbook/parked/file`(상태 표의 파일 이름만), `components/settings/WorkbookDiffView.tsx`, `/settings/workbook` 에 「사람이 손댄 내용」 구역. WorkbookAlert 문구도 바꿈. 테스트 `tests/workbook-diff.test.ts` 4개 + 실제 한 벌로 self-diff 0·수량 한 칸 바꾸면 1 확인. tsc·eslint·build·테스트 195개 통과. 🔴 **실행 중 화면(멈춤→차이 표시)은 사용자 확인 대기**(서버 메모리 때문에 지시 있을 때만 띄움).
  - ✅ **백업 둘(10-08 사용자 요청). 쓸 때마다 best-effort(실패해도 본 쓰기 성공).** 순수 규칙 `workbook-backup.ts` + `workbook-sync.ts` 의 `rotateDailyBackup`·`writeMonthlyBackup`·`listBackups`, `/settings/workbook` 에 두 줄. 테스트 `tests/workbook-backup.test.ts` 5개. 줄기(파일명) 맞는 백업만 다루므로 치워 둔 파일·다른 파일 안 건드림.
    - **일일**: `INVENTORY_DATA_DIR/backup/<파일명>_YYYY-MM-DD.xlsx`, 하루 한 벌(그날 것 최신 상태로 덮어씀), **30일 넘으면 지움**. NAS 야간 백업의 보완.
    - **월별 영구**: **원본 한 벌 폴더의 `OLD/`**(`dirname(STOCK_WORKBOOK_PATH)/OLD`, 사무실 공유 폴더에서 보임), `<파일명>_YYYY-MM.xlsx`, 달에 한 벌(그달 것 최신 상태로 덮어써 월말 상태로 굳음), **안 지움**. 일일과 이름 안 겹침(자리 수 다름)·폴더 다름. REQUIREMENTS 6절 「하루 한 벌 30일」 + 사용자 요청 「영구 월별」.
    - **자체 점검 `npm run workbook:selftest`**(`scripts/workbook-selftest.ts`, 2026-10-08 사용자 요청 「운영 이식 뒤에도 돌아야 함」): 한 벌을 한 번 쓰고(writeWorkbookNow) 원본·그림자·일일·월별 네 파일이 생겼는지·네 시트로 열리는지 확인. 경로는 전부 env 라 운영(NAS)에서도 같은 명령. DB 는 읽기만·엑셀 한 벌과 백업만 씀. PARKED 면 덮지 않고 알림. **10-08 개발 DB 로 실행 → 네 파일(각 173,285 B) 전부 통과 확인.** 설정 화면에는 백업 안내 + [월별 폴더]·[일일 폴더] 복사 링크(원본 옆 OLD, 데이터 폴더 backup).
  - ▶ **조각 8-B(다음): [엑셀 기준 적용] — 2단계 관리자 승인 관문 → 원장 반영.** 엑셀 줄(더한 줄·바뀐 수량)을 기록 입력으로 바꿔(가져오기 match 규칙 재사용) `recordEntry` 로 씀. 승인 화면에 적을 기록·건수·사유, 멱등. 8-A 화면 확인 뒤 계획 다시.
- 🔴 **(10-07 저녁): 조각 7 끝(코드 + 0007 적용 + 실제 동작 검증). 사용자 화면 확인 대기 — `/settings/workbook`, 한 벌 파일 `C:\DSS-INVENTORY-DATA\workbook\재고 및 견적 현황판.xlsx` 을 엑셀로 열어 보기.** 검증: 서버 켜진 15초 뒤 한 벌 씀(173KB, 부품 84·사용 9·입고 1·변경 7줄), openpyxl 로 네 시트·표 범위(A1:L85·O1662·K664·N8)·날짜 서식·엑셀 관용구 확인 / 파일에 1바이트 덧붙이고 다음 차례 → `현황판_사람수정_YYYYMMDD-HHMM.xlsx` 로 치우고 PARKED + 감사 WORKBOOK_PARKED(기대대로; 시험 파일은 지움). **실측 함정 셋**: ① drizzle `sql\`\`` 조각에 JS Date 를 넣으면 postgres.js 가 거부 → `toISOString()::timestamptz` ② 트랜잭션 안에서 문장 하나가 실패하면 뒤 문장이 전부 거부돼 catch 의 ERROR 기록도 실패 → 쓰기+기록을 **세이브포인트**(`tx.transaction`)로 감쌈 ③ dirty_at 을 「= 읽어 둔 값」으로 견주면 ms/µs 차이로 안 지워짐 → `dirty_at <= 이번 차례 시작 시각` 이면 지움. 사용자 지적(10-07) 반영: 「써야 할 변경」→「엑셀에 아직 반영 안 된 변경」(없음 — 엑셀이 프로그램과 같습니다), 한 벌 파일 경로 표시, **[한 벌 사본 내려받기]**(`GET /api/workbook/file`, 관리자 — 사용자 확인: 「원본으로 들어가는 게 아니다」, 사본임을 단추·안내에 명시) · **원본 위치 표시** = env `STOCK_WORKBOOK_SHARE_PATH`(사람이 탐색기로 가는 경로, 화면 전용, 비면 STOCK_WORKBOOK_PATH) — NAS 에서는 컨테이너 안 경로와 공유 폴더 경로가 달라 따로 둠(10-07 사용자 요청). 1·3번(문구·자동 갱신) 확인 「잘됨」. 그 뒤(10-07): 원본 위치는 **폴더 경로·파일 경로 두 줄 + [복사]**(`CopyPath`, 웹은 탐색기를 못 열어 복사해 붙여 넣는 길 — 사용자 「폴더 바로 뜨게」 요청의 한계 설명함). 남은 것: 실자료 전환 준비(담당자 백업 확인·NAS 환경변수·`--real`), 담당자에게 표 범위 함수 보여 주기.
- ▶ **조각 7 코드(2026-10-07 밤).**
  - **한 벌 틀 다시 만듦**: `scripts/build-workbook-template.ts <현황판.xlsx> <틀.xlsx>` → `C:\DSS-INVENTORY-DATA	emplates\재고 및 견적 현황판 틀_과거줄포함.xlsx`(옛 틀은 그대로 둠). 현황판 사본에서: 부품 재고 현황은 머리글+¥·₩ 본보기 2줄, **사용처·입고 기입란은 XML 그대로**(과거 줄 1,652·662 값째), 수량 변경 기록은 사용처 시트를 베껴 칸 이름만 바꿈(같은 styles.xml 이라 서식 번호 안 어긋남 — 옛 틀의 4번 시트를 가져오면 다른 파일 서식 번호라 못 씀). 표·관계·내용 형식·Print_Titles·app.xml 갱신. openpyxl 로 열림 확인.
  - 표 `workbook_states`(한 줄, 고정 id `00000000-0000-4000-8000-000000000001`): status OK/PARKED/ERROR, dirty_at, written_at/size/sha256, parked_file(이름만), error_count…
  - `src/lib/excel/full-workbook.ts`(순수): 부품 시트 다시 쓰기(`fillPartsSheet`, 내려받기와 공용) + 세 시트에 줄 붙이기(`appendRowsToSheet`: 본보기 = 마지막 줄, 값 있으면 그 아래부터·빈 본보기면 그 자리부터, 날짜는 일련번호). `rows.ts`: DB 줄 → 시트 칸(엑셀 관용구: 없으면 `-`, 둘째 줄 No. 비움, 「수리/정영빈」, 유상·무상). `workbook-data.ts`: 부품 전체 + 원장 전체(OPENING 제외). 🔴 둘 다 `server-only` 없음 — instrumentation 에서도 부르므로.
  - `workbook-sync.ts`: `markWorkbookDirty(tx)`(원장 writeEntry·부품/항목 변경 5곳·import 스크립트에서 같은 트랜잭션으로) · `runWorkbookSync()`(조언 잠금 → PARKED 면 건너뜀 → 1분 미만이면 대기 → 파일 크기·sha256 이 기록과 다르면 `현황판_사람수정_YYYYMMDD-HHMM.xlsx` 로 치우고 PARKED + 감사 WORKBOOK_PARKED → 틀+DB 로 만들어 `.tmp-pid` 에 쓰고 rename → 기록 갱신, 쓰는 동안 들어온 dirty 는 남김 / 실패하면 ERROR·error_count++) · `resumeWorkbook`(감사 WORKBOOK_RESUMED) · `writeWorkbookNow`.
  - `instrumentation.ts`: 켜진 15초 뒤 한 번 + 1분마다. `WORKBOOK_SYNC_DISABLED=1` 이면 끔. env `INVENTORY_DATA_DIR`·`STOCK_WORKBOOK_TEMPLATE_PATH`·`STOCK_WORKBOOK_PATH`(+ `STOCK_DOWNLOAD_TEMPLATE_PATH`)를 시작 검사에 넣음(`.env.local` 에 값 넣음, 한 벌은 `C:/DSS-INVENTORY-DATA/workbook/재고 및 견적 현황판.xlsx`).
  - 화면: `/settings/workbook`(상태·마지막 쓴 시각·크기·지문·써야 할 변경·치워 둔 파일·[다시 쓰기 시작]·[지금 쓰기]), 관리자 레이아웃 위쪽 `WorkbookAlert` 띠(PARKED·ERROR 일 때). SettingsNav 에 「엑셀 상태」.
  - 테스트 190개 통과(`tests/full-workbook.test.ts` 실제 틀 포함). 백업: **프로그램이 일일 백업을 직접 둔다**(조각 8, 아래 10-08) + 담당자의 NAS 야간 백업(데이터 폴더 통째, DESIGN 6-4절) — 보완 관계.
- ▶ **조각 6 코드(2026-10-07).** 틀 두 벌 중 내려받기 틀만 쓴다(한 벌 자동 갱신은 조각 7).
  - 엑셀: `src/lib/excel/stock-workbook.ts`(순수 함수) — 틀의 본보기 줄 둘(¥ 줄·₩ 줄, 공급가 칸 서식으로 가림)을 베껴 번호 매기고 값만 갈아 끼움. **표 범위는 `xl/tables/tableN.xml` 의 `ref` + `autoFilter ref` 두 군데**(`retargetTable`, 표 파트는 시트 관계 파일에서 찾음 — 담당자에게 보여 줄 함수). **줄 높이는 `ht`·`customHeight` 를 떼서** 엑셀이 열 때 맞추게(`dropRowHeight`). 값 규칙: 품명2·교산·도번 없으면 `-`, 비고 없으면 빈칸, 금액 없으면 `-` 글자, 숫자는 숫자. 테스트 `tests/stock-workbook.test.ts`(작은 틀을 메모리에 만들어 검사 + `STOCK_DOWNLOAD_TEMPLATE_PATH` 가 있으면 실제 틀로 319줄).
  - 경로: `GET /api/export/parts?<목록 주소 조건>` — 세션으로 지킴(보기 역할도 됨), 틀은 env `STOCK_DOWNLOAD_TEMPLATE_PATH`(`.env.local`·`.env.example` 에 추가, 없으면 명확히 실패). 파일 이름 `재고 현황_YYYY-MM-DD.xlsx`(filename* UTF-8 + ascii 대체).
  - 「지금 조건에 맞는 부품 전체」는 `src/lib/parts/selection.ts` 가 목록과 **같은 순수 함수**(applyFilter·applySort·applyPins)로 같은 차례를 만든다. 쪽·상세 창은 무시.
  - 인쇄: `/print/parts?<조건>`(머리말 없는 화면, 세션 검사 직접) — A4 가로 `@page`, 쪽마다 머리글(`thead` table-header-group), 줄 안 잘림, 「확인」 빈칸. 인쇄 창은 [인쇄]를 눌렀을 때만(10-07 사용자: 자동으로 띄우면 미리보기가 둘). `globals.css` 의 `@media print` 에 `.print-table` 규칙.
  - tsc·eslint·테스트 184개(실제 틀 포함) 통과.
- ✅ **(10-07) 목록의 찾기·거르기·정렬·쪽·연도·자주 사용 기준은 서버를 안 부른다** — 사용자: 「버튼 하나 누를 때마다 시간이 엄청 걸린다」. `router.replace` 는 주소만 바뀌어도 서버 컴포넌트를 다시 그려(RSC 왕복, dev 에서 0.2~2초) 부품 전체를 또 읽었다. `PartsList.navigate` 가 `window.history.replaceState/pushState` 로 주소만 바꾸고(Next 14.1+ Native History API, useSearchParams 가 따라옴) **상세 창을 새로 열 때만** router.push. 함정으로 기억: 이 PC 는 RAM 7.4GB·여유 1.4GB 라 dev 서버가 느리다(첫 방문 컴파일 2~7초). 사용자 확인용으로는 `npm run build && npm start` 가 훨씬 빠르다(10-07 저녁부터 그렇게 띄움. `output: standalone` 경고가 뜨지만 화면·정적 파일 다 나온다. **코드를 고치면 다시 build 해야 반영**). 메모리 부족으로 백그라운드 서버가 두 번 죽었고, 죽은 프로세스가 3800 포트를 잡고 응답을 안 하는 일이 있었다 → 다시 켤 때 `netstat -ano | findstr :3800` 으로 먼저 정리.
- ✅ **(10-07) 항목 고르기 상자를 다섯 줄만 보이고 굴리는 `ScrollSelect`(단추+listbox, 라이브러리 없음)로 바꿈** — 네이티브 select 는 펼침 길이를 못 줄인다. **상세 창에 관리자용 [수량 조정] 단추**(`/entries/new?type=ADJUST&part=No`) — 실물 점검 수량 반영 길을 사용자가 못 찾았음. 조정 자체는 조각 4 의 ADJUST(관리자만, 차이만큼 원장 줄).
- ✅ **자주 사용 기준 패널(10-07 사용자 요청 「기준 숫자 바로 조절, 횟수/수량 스위치, 2개월 단위 36개월 기간 바」).** 서버는 `usageByMonth()`(최근 36개월 월별 [건수, 수량], 원장 사용 줄 취소 제외 + 확인된 과거 사용)만 내려주고, 규칙은 **주소 상태**(`fm` n/q · `fp` 짝수 2~36 · `ft` 1 이상, 기본 n·12·3)로 화면에서 계산(`src/lib/parts/frequent.ts` 순수 함수, 테스트 `tests/frequent.test.ts`). 기간은 **이번 달 포함 최근 N개월**(달 단위). 자주 사용 묶음은 **잰 값 큰 순**(`applyPins` 이 Map 을 받음). **수량 모드는 기준 없음**(10-07 사용자: 「많은 애가 위로 노출되면 된다」) — 기간 안에 쓴 부품 전부가 수량 많은 순, 기준 칸은 숨기고 `ft` 도 안 씀. 패널은 [기준 ▾] 단추로 접음, 기준 숫자 칸은 놓을 때(blur·Enter) 반영. 이전의 `frequentPartIds`(365일·3건 고정)는 지움.
- ✅ **`--real` 임시 DB 시험 끝(2026-10-07, 사용자 결정 「임시 DB 시험 하자」).** 같은 컨테이너에 `dss_inventory_import_test` 를 만들어 `DATABASE_URL` 만 바꿔 migrate → seed-items → `db:import --real`(전환일 2026-10-07) → SQL 대조 → 재실행 거절 확인 → **DROP DATABASE**. 결과 전부 기대대로: 부품 319(No. 1~319, 번호표 319, `-` 남은 칸 0, ₩ 2개=No.224·225 Flow sensor, 항목·소유·분류 분포가 파이썬 집계와 같음) / 수량 캐시 합 10,002(0인 부품 61) / OPENING 한 건(CH-2026-1) 줄 258, delta 합 10,002, before 전부 0, after=캐시 / 과거 기록 2,288(사용 1,349+237+55 · 입고 545+85+17), (시트,행) 중복 0, 사정 2줄(입고 265·497행) / 묶음 검증 No.22=84·No.185=2·No.7=4·No.181=0 / 전환일·감사 로그 WORKBOOK_IMPORT 한 줄. 두 번째 실행은 「parts 표에 이미 319줄」로 거절. 개발 DB 는 그대로(부품 88·과거 634·전환일 데모값). 실자료가 든 CSV 는 스크래치에서도 지움. **전환일에 돌릴 명령은 그대로 쓰면 된다** — 그날은 NAS 의 빈 DB 에 `--transition-date` 를 그날 날짜로. (2026-10-07 사용자 요청) ① 연도별 사용 수량 체크란은 [연도별 사용 수량 ▾] 단추로 접어 둠(연도를 고른 주소면 펼침) ② 「자주 사용하는 부품 위로」 체크(주소 `freq=1`) = 최근 365일 사용 기록 3건 이상(`frequentPartIds`, 건수 기준·원장+확인된 과거 기록, 상수 FREQUENT_DAYS·FREQUENT_MIN_USES) ③ 줄 맨 앞 ★ 즐겨찾기(사람별, `part_favorites`, 서버 액션 `toggleFavoriteAction`, 낙관적 표시) — 즐겨찾기는 항상 맨 위, 그다음 자주 사용, 나머지(`applyPins`, 정렬 뒤·쪽 나누기 전). tsc·eslint·build·테스트 173개 통과.
- ✅ **조각 5 사용자 확인 「맞음」(10-07).** 고친 것: 상세 창 과거 기록 표에서 **소유 불일치 줄은 숨김**(헷갈려서, 건수만 한 줄). 나중 요구: **사용 부품 통계는 소유와 상관없이 통합 조회**(REQUIREMENTS 「나중에 붙일 화면」에 적음). 다음: `--real` 임시 DB 시험 여부 결정 → 조각 6(인쇄·엑셀 내려받기). 조각 5 경과 — `/?y=2026,2025,2024&part=20`(연도 칸·소유 불일치 3건·날짜 없는 줄 1건), No.1(원장 사용 6−반환 1=5, 대여·취소 제외 확인), `/settings/transition`. 검증: 과거 기록 연도 합 = SQL 직접 합, 목록 usage = 상세 partYearly, 사용된 제품은 과거 사용처 글자에서 기종. 데모 과거 기록 날짜가 전환일(10-01) 뒤 2026-12 까지 있는 것은 데모 생성기의 한계(실자료엔 없음). 시드 가드는 **지워진 부품을 빼고** 「예시 」검사(No.86 시험 부품이 소프트 삭제로 남아 있음). tsc·eslint·build·테스트 171개 통과. 기록 내역 필터는 사용자 확인 끝(「없음, 다음」), 배치도 자주 쓰는 순서로 바꿈.
- ▶ **조각 5(과거 기록 + 연도별 사용 수량) 코드 완료(2026-10-07).**
  - 표: `legacy_records`(엑셀 한 줄 적힌 그대로. 소유도 글자 `owner_text`, 숫자 아닌 칸은 null + `anomaly`, `part_id` NOT NULL, `match_status` CONFIRMED/GROUP_DECIDED/OWNER_MISMATCH, 소프트 삭제 없음=append-only) · `app_settings`(열쇠 하나 = 전환일 `transition_date`). 스키마 `src/db/schema/{legacy-records,app-settings}.ts`, 마이그레이션 `drizzle/0005_*.sql`.
  - 순수 함수 `src/lib/legacy/`: `workbook.ts`(머리글 이름으로 칸 찾기, 글자 그대로) · `workbook-styles.ts`(공급가 ¥/₩ 는 **칸 서식**에만 있어 styles.xml 의 cellXfs 를 직접 읽음 — ₩ 는 2줄뿐) · `match.ts`(열쇠 = 품명·품명2·도번·소유 **엑셀 글자 그대로**, 교산 품번은 안 봄, 묶음은 판정표 (시트,행)으로, 판정 No. 가 후보 밖이면 UNMATCHED 로 알림) · `yearly.ts`. 테스트 `tests/legacy.test.ts` 16개.
  - 서버 읽기 `src/lib/legacy/queries.ts`: 전환일, 부품 과거 기록, 연도별 사용(원장 사용 − 그 줄에 대한 반환 − 취소, 대여 제외 + 확인된 과거 기록; 소유 불일치는 빼고 「확인되지 않은 과거 기록 N건 제외」), 연도별 입고·사용, 사용된 제품(사용처 글자 둘째 토막 = 기종 + 원장 product_model).
  - 스크립트 `npm run db:import -- --check-only <xlsx> --decisions <csv> --unmatched <csv>` / `--real …`: **검사만 모드로 실제 현황판 사본을 돌려 설계서 네 갈래 숫자와 정확히 일치 확인(사용 1,349/237/55/11 · 입고 545/85/17/15, 못 붙인 26건, 칸 사정 2건)**. `--real` 은 parts·stock_entries·legacy_records 가 전부 빈 DB 에만(데모 위에 섞지 않음), 부품 No. 그대로 + setval, OPENING 한 건(수량 0 은 줄 없음), 과거 기록, 전환일, 감사 로그 WORKBOOK_IMPORT — 한 트랜잭션. 🔴 **--real 은 아직 한 번도 안 돌림**(빈 DB 가 없어서). 전환일 전에 임시 DB 로 한 번 시험할지 사용자 결정 필요.
  - `npm run db:seed-demo-legacy`: 데모 부품에만, legacy_records 비었을 때만, 전환일 데모값 2026-10-01(없을 때만).
  - 화면: 목록에 「연도별 사용 수량」 체크(주소 `y=2025,2024`) → 수량 뒤에 연도 칸(정렬 없음) + 「확인되지 않은 과거 기록 N건 제외」 / 상세 창에 연도별 입고·사용 표, 사용된 제품, 「전환일(날짜) 이후 · 이 프로그램에 쌓인 기록」, 점선 상자 「전환일 이전 · 엑셀에서 가져온 과거 기록 (참고용)」(합계 따로, 소유 불일치·묶음 판정 표시, 수량 계산에 안 씀 문구) / `/settings/transition`(보기만, SettingsNav 로 항목 관리와 오감).
  - 함정: Bash 로 백틱(`${}`)이 든 긴 치환 스크립트를 heredoc 으로 넘기면 깨진다 → 파이썬 파일로 두고 돌린다. 스크래치패드의 tsx 는 프로젝트 패키지를 못 찾으므로 DB 검증 스크립트는 `scripts/_tmp-*.mts` 로 잠깐 두고 지운다.
- ✅ **(10-07) 기록 내역 필터 검증 + 둘 고침.** 사용자가 「어제 필터에서 덜 나오는 게 있었다」고 해서 DB 의 기록 15건 전부에 사람이 칠 만한 값 460가지를 돌려 봄(스크립트는 프로젝트에 안 넣음). 덜 나온 것 넷 중 **사용자 결정으로 둘만 고침**: ① 담당 칸이 기록자만 보고 **확인자**를 안 봐서 「정영빈」이 15건 중 14건 — `listEntries` 의 actor 를 created_by_name OR confirmed_by_name 으로, 라벨 「신청자·기록자·확인자 이름」. ② 사유·빌려준 곳·비고·고객명·제품 모델·사용처·목적 글자·줄 비고를 찾을 칸이 없음 — **「내용 찾기」 칸(`text`)** 추가. **안 고치기로 한 둘**: 띄어쓰기·하이픈이 다르면 못 찾음(「예시PCB-001」·「예시 PCB 001」), 「No. 7」처럼 치면 0건(숫자만 쳐야 No.). tsc·eslint·build·테스트 155개 통과.
- (10-06 저녁 마감 당시) 기록 내역(`/entries`)의 **새 필터 상자**(큰 라벨, 날짜 한 줄, 「부품 찾기」 + 찾을 곳 체크 No.·품명·품명2·도번·교산 품번, 인수번호, [필터 적용]) 를 사용자가 눈으로 확인 → 괜찮으면 **조각 5(과거 기록 가져오기 + 연도별 사용 수량)** 시작. 오늘 마지막 상태는 tsc·eslint·테스트 155개·build 전부 통과. git 커밋은 아직 한 번도 안 함(사용자 요청 없음).
- 오늘(10-06) 하루에 조각 1→4 를 전부 만들고 사용자 확인까지 받음. 아래 ✅ 들이 그 기록. 담당자에게 보낼 것: 구분 글자 = 비고(`note`), 한계수량 안 씀, `API.md`·`docs/AS스냅샷_비교_2026-10-06.md`·`docs/방향_검토_2026-10-06.md`, 보강 제안 셋은 「검토 중」, 쓸 사람 명단(급하지 않음).

- ✅ 인터뷰 → `REQUIREMENTS.md` → `DESIGN.md` → **담당자 설계 승인.** 포털 등록(client_id `dss-inventory`, 역할 3개, 지정된 사람만, 정영빈=ADMIN)도 담당자가 끝냄.
- ✅ **조각 1(통합 로그인 + 빈 화면) 코드 작성 완료**, `next build --webpack` · eslint · `node --test` 28개 통과. 마이그레이션 SQL `drizzle/0000_*.sql` 생성됨(**아직 적용 안 함**).
- ✅ **(10-06 저녁) Docker Desktop 4.94 설치됨 → `npm run db:up` 성공.** 컨테이너 `dss-inventory-db`(PostgreSQL 17.11, 127.0.0.1:5450) healthy, 테이블 없음. `npm test` 28개 여전히 통과.
- ✅ **(10-06 저녁) `vendor/dss-ui` 서브모듈 받음**(사용자 지시로 실행, `.gitmodules` 생김) → `tsconfig.json` paths 에 `@dss/ui`·`@dss/ui/styles.css`, 루트 레이아웃에 CSS import, `AppHeader` 가 `ServiceMenuBar variant="inline"` 사용, 임시 `ServiceMenu.tsx` 삭제. tsc·eslint·build·테스트 28개 통과.
- ✅ **(10-06 저녁) `npm run db:migrate` 적용됨**(사용자 승인) → 개발 DB 에 users·audit_logs·role enum. `npm run dev` 띄워 `/` → `/api/auth/sso/start` → 포털 authorize 로 가는 것(PKCE S256·nonce·state 포함)과 포털 discovery 응답 200 을 curl 로 확인.
- ✅ **조각 1 끝(2026-10-06).** 사용자가 브라우저에서 카카오 로그인 성공 → users 에 `정영빈 / ADMIN` 행 1개, audit_logs 에 `LOGIN`(roleClaimPresent=true). 담당자에게 알릴 글자: 이름 「정영빈」, 역할 「관리자 · ADMIN」. (로그아웃은 아직 안 눌러 봄 — LOGOUT 감사 기록은 코드에 있음)
- ✅ **담당자 답변3(2026-10-06, `받은자료/답변3_2026-10-06.md`) 반영.** No. 로 감(묶음 키 없음) + A/S 고르개에 소유·「왜 따로」 글자 필요(**사용자 결정: 비고(`note`) 그대로, 용도 구분 칸 안 둠**) / **한계수량은 쓰지 않는다(사용자 결정)** / A/S 잠금·작업비 표·API 전환은 담당자 일 / 쓰기 통로는 **재고가 열고 A/S 가 부름 + 멱등 필수** / **저장 뒤 그 자리에 남기 적용** → 기록 화면이 redirect 대신 팝업 + `router.refresh()`(함정: 다시 읽지 않으면 옛 값이 보임). 정리는 `docs/방향_검토_2026-10-06.md` 7·8절. 담당자가 받고 싶어 하는 것: 16묶음 구분 칸 답, API.md, 비교 문서, 보강 제안 셋, 쓸 사람 명단.
- ✅ **담당자 확인 단계 끝(2026-10-06): 0004 적용(사용자 승인) + DB 로직 검증.** 신청 4건 → 확인(수량 −2, created_by=신청자·confirmed_by=관리자·request_id 연결) / 두 번째 확인 거절 / 수량 부족 신청은 거절되고 PENDING 유지 / 반려·본인 취소 / 남이 취소 거절 — 전부 기대대로. 사용자 화면 확인 1·2·3 「다 됨」(2026-10-06). 기록 번호에 시트 접두(US/RC/CH) 붙임. 신청 흐름은 역할 바꿔 보기로 시험. 반출 계열(사용·대여·폐기)을 STAFF 가 적으면 `stock_requests`(확인 대기)로, ADMIN 이 [확인]하면 그때 `recordEntry`(created_by=신청자, confirmed_by=담당자, request_id UNIQUE). 집기(PENDING→CONFIRMING)로 두 번 확인 방지, 실패하면 PENDING 복귀. [반려(사유)]·[신청 취소]. 기록 내역 맨 위 「확인 대기」 묶음 + 머리말 「대기 N」. `src/lib/stock/requests.ts`, `RequestActions.tsx`, `codes.ts` 의 `needsConfirmation`. 반출 시점 결정: **(가) 부품이 나가는 순간 원장에 적는다**(A/S 신청도 확인 단추가 우리 통로를 호출). DESIGN 2-4·REQUIREMENTS 5절에 적음. tsc·eslint·build·테스트 154개 통과.
- ✅ **결정(2026-10-06, 사용자↔담당자): 부품 현황표의 기준은 이 시스템.** A/S 는 가져다 쓴다. 방향 검토는 **`docs/방향_검토_2026-10-06.md`** — 지금 설계 그대로 가되, 잇는 자리(부품 단위 No. vs 품명 묶음, A/S 전용 속성은 A/S 에 우리 No. 로, 전환 뒤 A/S 등록·수정·원장 잠금, 삭제 표시·묶음 키를 API 에 추가)를 담당자와 정한다. 담당자 질문 5개가 6절에.
- ✅ **A/S 재고 기능 사본을 읽음(2026-10-06).** 담당자가 뜬 읽기용 저장소 https://github.com/kiri190-me/dss-as-inventory-snapshot (105개 파일). 비교 결과는 **`docs/AS스냅샷_비교_2026-10-06.md`** — 같은 것(원장 합이 진실·반납 재계산·순수 함수·저장 쪽 권한), 일부러 다른 것(결재선·요청·소유 넷·종류 셋·역할 다섯·위치 버킷·휴지통·한계수량), 가져올 것 셋(원장 줄 CHECK 보강=마이그레이션, 부품 수정 동시성, 이력 있는 부품 삭제 단추 끄기) + 나중 자리. 사본 파일은 스크래치에만 두고 저장소에 넣지 않았다.
- ⏸ **API 는 보류(2026-10-06, 사용자가 담당자와 상의).** 코드·`API.md`·개발 토큰은 그대로 두되 담당자에게 보내지 않는다. 대신 **담당자가 만들고 있는 A/S 시스템(RF_Service_System) 소스를 참고**해 재고 화면·요청 흐름을 맞추기로 함. 🔴 이 PC 에는 그 소스가 없다(`Desktop\RepairBoard` 는 사용자 본인의 파이썬 수리 업무 보드). 사용자가 담당자에게 저장소 주소·권한을 받아 `C:\Users\정영빈\` 아래에 클론하면 **읽기만** 한다(2-3절). 볼 것: `/inventory`·`/inventory/requests`·`/inventory/approvals`·`/inventory/oh-templates` 화면과 표, `src/lib/xlsx` 사용 예, 머리말·목록 관용구, 역할 가드.
- ✅ **읽기 전용 부품 API 열림(2026-10-06).** 담당자가 "A/S 에서 API 로 가져가겠다" 고 해서(사용자 전달). `GET /api/v1/parts`(owner·category·item·q·since) · `GET /api/v1/parts/{no}`. 공유 토큰 `INVENTORY_API_TOKEN`(Bearer, timingSafeEqual, 없으면 503). 모양·약속은 **`API.md`**(담당자에게 보낼 문서). 4-1절에 A/S 반출 신청→원장 통로(`POST /api/v1/entries`) **제안만** 적어 둠 — 담당자가 길(①옮김 ②호출 ③직접 기록)을 고른 뒤 연다. 개발용 토큰은 `.env.local` 에 생성해 둠. curl 로 401/400/404/200 확인, 테스트 151개 통과.
- ▶ **조각 4 코드 작성 완료 + 0002·0003 적용(2026-10-06, 사용자 승인) + DB 로직 검증 끝, 사용자 브라우저 확인 대기.** 검증: 사용(실제 수량 다름→조정 먼저)·사용(인수번호→확인 안 됨)·입고·반환(남은 수량 초과 거절)·조정(같으면 거절)·대여·폐기·부족 거절·소유 옮김 품명 불일치 거절·기록 취소(두 번째 거절)·재확인(통로 없음) 전부 기대대로, 처음 수량+원장 합 = 현재 수량 일치. 데모 DB 에 2026년 기록 8건이 쌓여 있음(No.1·No.2). 수량 변경 기록 7종 + 기록 내역 + 기록 취소 + 인수번호 확인.
  - 표: `stock_entries`(머리: 종류·시트·날짜·연도별 순번·인수번호·확인 안 됨·여섯 값 복사·사용처 글자·목적·빌려준 곳·사유) · `stock_transactions`(원장: delta≠0 CHECK, quantity_before/after 는 표시용, returns/reverses). 스키마 `src/db/schema/stock.ts`. 0003 은 `--custom` 으로 만든 COMMENT 전용(담당자 요청 3-1절).
  - 원장 쓰기는 `src/lib/stock/ledger.ts` **한 곳**: 번호표(advisory lock) → 머리 → 줄 → stock_balances → 감사 로그 한 트랜잭션, FOR UPDATE, 0 아래 거절. 사용의 「실제 수량이 다릅니다」는 ADJUST 를 먼저 쌓고 USE. 반환은 사용·대여 줄의 남은 수량까지. 소유 옮김은 같은 품명·다른 소유만. 기록 취소 = 되돌리는 줄(CORRECTION, 한 줄 한 번).
  - 인수번호: `src/lib/stock/intake-lookup.ts`. **통로 주소(AS_LOOKUP_URL)가 아직 없어** 「응답 없음」으로 다룸 → 저장되고 intake_unverified. 기록 내역의 「인수번호 확인 안 됨」 거르기 + [확인]. 응답 모양은 `parseLookupResponse` 한 곳만 맞추면 됨.
  - 화면: `/entries/new`(휴대폰 세로, 종류별 칸, 부품 찾기, JSON 줄) · `/entries`(거르기 7종, 줄마다 기록 취소·확인) · 상세 창 「이 프로그램에 쌓인 기록」 + [반출][입고] · 머리말 메뉴 둘 추가. 부품 삭제가 원장 줄 있으면 막힘(조각 3 TODO 해소).
  - tsc·eslint·build·테스트 146개 통과. DB 적용 전이라 실제 기록 흐름은 미확인.
- ✅ **조각 3 끝(2026-10-06, 사용자 확인 3차까지 「잘 보임, 넘어가자」).** 부품 등록·수정·삭제 + 중복 경고 + 항목 관리 + 변경 이력. 스키마 변경 없음(마이그레이션 없음).
  - 서버 액션 `src/app/actions/{parts,part-items}.ts`(useActionState 모양, 역할을 액션에서 다시 검사). 검사는 순수 함수 `src/lib/parts/form.ts`, DB 변경은 `src/lib/parts/mutations.ts`(본 작업 + 감사 로그 한 트랜잭션).
  - 화면: `/parts/new`·`/parts/[no]/edit`(PartForm + DeletePartForm, 네이티브 dialog) · `/audit`(서버 쪽 쪽 나누기 50건, 행위로 거르기, 앞·뒤 값 한글 표시) · `/settings/items`(추가 + 위로/아래로는 평범한 form action). 머리말에 재고 현황·변경 이력·설정 메뉴(관리자만 뒤 둘). 목록의 [부품 등록]과 상세 창의 [수정] 연결.
  - **사용자 확인(2026-10-06 1차)에서 고친 것 둘**: ① 같은 이름 경고가 네 칸(품명·품명2·도번·소유) 다 같을 때만 떠서 못 봄 → **품명만 같아도 보여 주고** 네 칸 다 같은 것은 「같은 부품」, 아니면 「품명만 같음」 표시. 또 사람이 엑셀 습관대로 `-` 를 치면 품명2·교산 품번·도번·비고는 **빈 값**으로 받는다(form.ts `textOrEmpty`). ② 상세 창에서 고친 기록을 찾을 길이 없었음 → 관리자에게 [변경 이력] 단추(`/audit?part=No.`, 부품 하나로 거르기) 추가.
  - 삭제 규칙: 수량 0 이고 기록 없는 부품만(원장은 조각 4 라 지금은 수량으로만 막음, mutations.ts 에 TODO). 소프트 삭제 4칸 + 사유.
  - 확인: tsc·eslint·build·테스트 129개 통과. DB 로직은 tsx 스크립트(`node --conditions=react-server --import tsx`)로 등록→중복→수정→삭제→항목 순서까지 실제 DB 에서 돌려 봄(No.84·85 는 숨김으로 남음). **브라우저에서의 폼 동작은 사용자가 확인.**
- ✅ **조각 2 끝(2026-10-06, 사용자 화면 확인 「잘됨」).** 부품 넣기 + 목록 + 상세(읽기만). 마이그레이션 0001 적용(사용자 승인), 항목 19종·데모 부품 83개(수량 합 4,034, 0인 것 12) 들어감. 로그인한 상태의 `GET /` 가 200 으로 렌더되는 것을 dev 로그로 확인.
  - 표: `part_items`(항목 19종, 표로 둔 이유는 관리자가 화면에서 더하기 때문) · `parts`(No. 는 시퀀스 `parts_no_seq` DEFAULT nextval) · `stock_balances`(CHECK quantity>=0). 스키마 `src/db/schema/{codes,part-items,parts,stock-balances}.ts`, 마이그레이션 `drizzle/0001_*.sql` 적용됨(2026-10-06).
  - 화면: `src/app/(app)/page.tsx` → `src/components/parts/PartsList.tsx`(클라이언트, 찾기·거르기·정렬·쪽을 주소에) + `PartDetailDialog.tsx`(네이티브 dialog, `?part=No.`). 계산은 전부 순수 함수 `src/lib/parts/list-state.ts`(테스트 있음). 코드값 글자 `src/lib/parts/codes.ts`. `(app)/error.tsx` 추가(한국어 오류 화면).
  - 자료: `npm run db:seed-items`(항목 19종, 기준 자료, 몇 번 돌려도 됨) → `npm run db:seed-demo`(만든 부품 ~70개, 품명 「예시 」로 시작, **parts 가 비어 있을 때만** 돈다).
  - 엑셀 코드 묶음을 `src/lib/xlsx/` 에 풀었다(고치지 않음). 본보기 `customer-portal-export-workbook.ts` 는 A/S 전용 모듈을 import 해서 `tsconfig.json` exclude 에 넣었다(파일은 그대로). 묶음의 테스트 59개도 `npm test` 에 포함.
  - tsc·eslint·`next build`·테스트 112개 통과. 인쇄·엑셀 내려받기·부품 등록·수량 변경 기록 버튼은 자리만(disabled, title 에 어느 조각인지).
- Docker Desktop 은 PC 를 켤 때 자동 시작이 아닐 수 있다. `docker info` 가 안 되면 Docker Desktop 을 먼저 연다.
- 📌 담당자 쪽 진행 중: 보류 16행·D240913 대조, A/S 인수번호 조회 통로(조각 4 전), 야간 백업(실자료 전).

### 다음에 할 일

| 순서 | 할 일 | 누가 |
|---|---|---|
| 1 | ~~Docker Desktop 설치 → `npm run db:up` → `npm run db:migrate`~~ (됨, 10-06) | 됨 |
| 2 | ~~서브모듈 받기 → `@dss/ui` 연결~~ (됨. 새 PC 에서 클론할 때는 `git clone --recurse-submodules`, 아니면 `vendor/dss-ui` 가 비어 빌드가 크게 실패한다) | 됨 |
| 3 | ~~로그인 확인~~ (됨) → **담당자에게 「정영빈 / 관리자 · ADMIN」 떴다고 알리기** | 사용자 |
| 4 | ~~조각 2 확인~~ (됨) | 됨 |
| 4-1 | ~~조각 3 확인~~ (됨) | 됨 |
| 4-2 | ~~조각 4~~ (됨, 10-06) | 됨 |
| 4-3 | ~~조각 5·목록 셋·조각 6·7·8-A·8-B·8-B 화면 확인~~ (됨, 10-12) → **실자료 전환 준비 중**: 절차서 됨(`docs/전환일_절차서_2026-10-12.md`), 담당자 답(백업·환경변수) 대기 | 사용자·담당자 |
| 5 | 조각 3~7 은 `DESIGN.md` 8절 순서대로. 실제 자료(부품 319개·과거 기록)는 담당자가 백업을 확인해 준 뒤 | |
| — | 쓸 사람 명단과 역할을 담당자에게 (급하지 않음) / 표 범위 함수를 다 되면 담당자에게 보여 주기(조각 6) / 묶음 판정 CSV·틀 두 벌은 전환일에 담당자에게(`C:\DSS-INVENTORY-DATA\`, **지우지 말 것**) | 사용자 |

### 시작하는 방법

```bash
npm install
# .env.local 은 이미 있다 (시크릿 포함. 출력하지 말 것). 없으면 .env.example 을 복사해 채운다.
npm run db:up          # Docker Desktop 필요. PostgreSQL 17 을 127.0.0.1:5450 에
npm run db:migrate     # drizzle/ 의 SQL 적용 — 사용자 승인 뒤에만
npm run dev            # http://localhost:3800  (🔴 localhost 로 열어야 포털이 돌려보낸다)
npm run db:seed-demo-legacy   # 데모 과거 기록 + 데모 전환일 (조각 5 화면 확인용, 데모 부품에만)
npm run db:import -- --check-only <현황판.xlsx> --decisions <판정표.csv> --unmatched <못붙인.csv>   # 실자료 검사만(DB 안 씀)
npm run workbook:selftest   # 한 벌을 한 번 쓰고 원본·그림자·일일·월별 네 파일이 생겼는지 확인(운영에 이식돼도 같은 명령)
npm test               # node --test (DB 없이 돈다)
npm run build          # next build --webpack
```

로그인 화면은 담당자 PC(`192.168.1.132:3100`)의 개발 포털이다. 안 뜨면 그 PC 가 꺼진 것, 어제까지 되던 로그인만 막히면 주소가 바뀐 것 → 담당자에게.

### 이 프로젝트에서 밟은 함정 (왜 그렇게 했나)

- **`instrumentation.ts` 는 edge 런타임용으로도 컴파일된다 — node 전용 코드는 `if (process.env.NEXT_RUNTIME === "nodejs") { await import(…) }` 블록 안에서만, 본문은 `instrumentation-node.ts` 에.** `if (… !== "nodejs") return;` 으로 먼저 빠져나오는 꼴은 웹팩이 죽은 가지로 걷어내지 못해 edge 컴파일이 `node:crypto` 에서 "UnhandledSchemeError" 로 깨지고 **개발 서버의 모든 페이지가 500** 이 된다(2026-10-12 실측. `next build` 는 통과해서 10-08 에 못 잡았다 — 프로덕션은 죽은 가지를 걷어낸다). 같은 파일 안의 다른 함수로 빼도 소용없다.
- **엑셀 글자 비교는 줄바꿈을 LF 로 맞춘 뒤 한다.** DB 비고 글자에 CRLF 가 들어 있고 프로그램은 그대로 쓰는데, 엑셀은 저장하면 LF 로 바꾼다(2026-10-12 실측: 수량 한 칸 고쳤는데 비고 19줄이 바뀐 것으로 나옴). `workbook-diff.ts` 의 `normalizeText`.
- **Docker Desktop 은 PC 를 켤 때 자동으로 안 뜬다.** `docker info` 가 실패하면 `C:/Users/정영빈/AppData/Local/Programs/DockerDesktop/Docker Desktop.exe` 를 먼저 띄운다(사용자 로컬 설치. Program Files 에 없다). 뜨면 `dss-inventory-db` 컨테이너는 저절로 올라온다.
- **포트 3800 / DB 5450.** 처음 받은 3700·5448 은 휴가 관리 시스템이 쓰고 있었다(2026-10-06 정정). 코드 어디에도 3700·5448 이 없어야 한다.
- **`SSO_ISSUER`·`SSO_REDIRECT_URI` 에 `auto` 를 쓰지 않는다.** 포털이 이 PC 가 아니라 담당자 PC 에 있다. redirect 는 `localhost:3800` 으로 등록되어 있어 브라우저도 `localhost` 로 열어야 한다.
- **`env.ts` 는 전부 getter.** `next build` 가 환경변수 없이 돌아야 해서(컨테이너 빌드) 값을 쓸 때 읽는다. 빠지면 서버 시작 때 `instrumentation.ts` 가 한꺼번에 던진다.
- **라우트 핸들러에서 쿠키는 `NextResponse.redirect()` + `res.cookies.set()`.** Next 16 문서는 `cookies().set()` 뒤 `redirect()` 가 쿠키를 보존한다고 보장하지 않는다. 레이아웃·페이지에서는 쿠키를 못 쓴다(서버 액션·라우트 핸들러만).
- **Next 16 은 `cookies()`·`params`·`searchParams` 가 전부 async.** `middleware` 는 `proxy` 로 이름이 바뀌었고 쓰지 않는다(세션 검증은 `(app)/layout.tsx` + 각 액션). `next lint` 는 없어져 `eslint` 를 직접 돈다. `cacheComponents` 는 꺼져 있어 cookies() 를 읽는 구간은 동적 렌더링이다.
- **`node --test` 의 테스트 파일에 최상위 `await` 를 쓰지 않는다.** package.json 이 CJS 라 tsx 가 변환 오류를 낸다. env 가 getter 라 `process.env` 를 먼저 채우고 정적 import 하면 된다.
- **로그아웃은 이 시스템 세션만 끊는다.** 포털에 post_logout_redirect_uri 가 등록돼 있지 않아 end_session 으로 보내지 않는다. 다시 [로그인] 을 누르면 포털 세션이 살아 있는 동안 묻지 않고 들어온다(설계대로).
- **백채널 로그아웃 수신부는 만들어 두었지만** 개발 포털에는 그 주소가 등록돼 있지 않다(NAS 때 담당자가). `users.last_sid` 는 logout_token 이 sid 만 들고 올 때를 위한 것.
- **useActionState 폼은 `<form action={formAction}>` 로 보내지 않는다.** React 19 가 액션이 끝난 뒤 폼을 자동 초기화해, 서버가 검사 오류·같은 이름 경고를 돌려줬을 때 고르기 상자가 비어 버린다(2026-10-06 사용자 확인: 휴먼 에러 위험). `onSubmit` 에서 `e.preventDefault()` 뒤 `startTransition(() => formAction(new FormData(form)))` 로 보낸다. 입력값은 로컬 state. 평범한 `<form action={serverAction}>` 은 되돌아올 상태가 없는 단추(항목 위로/아래로)에만 쓴다.
- **변경 이력 표는 바뀐 칸마다 한 줄**(칸 · 변경 전 · 변경 후 열, 앞 네 칸은 rowSpan). 한 칸에 줄로 쌓으면 둘째 줄이 눈에 안 띈다(2026-10-06 사용자 확인: 비고+공급가 동시 수정이 비고만 바뀐 것처럼 보임).
- **가계정·자체 로그인은 끝까지 만들지 않는다. 대신 개발 전용 「역할 바꿔 보기」**(2026-10-06, 담당자가 "가계정으로 시험하라" 한 데 대한 답). `DEV_ROLE_OVERRIDE=true`(개발 PC `.env.local`) + 운영 아님일 때만, **진짜 역할이 ADMIN 인 사람이 머리말에서 자기 역할을 낮춰** 본다(`DevRoleSwitch`, `actions/dev-role.ts`, 서명 쿠키 `inventory_dev_role`, `session.ts` 가 낮추는 방향만 받아들임). `session.user.role` = 지금 쓰이는 역할, `session.actualRole` = 포털이 준 역할. 운영(NODE_ENV=production)에서는 값이 있어도 꺼진다.
- **필터의 실행 단추 이름은 「필터 적용」**(검은 주 버튼) + 「조건 지우기」. 「보기」라고 쓰니 사용자가 적용 단추를 못 찾았다(2026-10-06). 칸에서 Enter 도 된다는 안내 한 줄.
- **필터 칸은 사람이 칠 만한 것을 다 받는다**(2026-10-06 사용자: 도번을 쳤는데 조용히 전체가 나옴). 기록 내역의 「부품」 칸은 숫자면 No., 글자면 품명·품명2·도번·교산 품번. 「담당」은 기록자·확인자 둘 다, 「내용 찾기」는 제목·비고에 보이는 글자 전부(2026-10-07). 띄어쓰기·하이픈 차이와 「No. 7」식 입력은 **안 받기로 함**(사용자 결정 2026-10-07). 적용된 조건과 건수를 표 위에 한 줄로 보인다. 모르는 값을 조용히 버리지 말 것.
- **기록 내역은 엑셀 기입란 모양**(2026-10-06 사용자): 건마다 대제목(수리 건이면 인수번호, 수리 건 없으면 「기타 사용 — 사유」, 나머지는 종류 — 상대·사유) + 그 시트의 칸을 그대로 둔 표(사용처: No.·날짜·인수번호·품명·품명2·도번·교산 품번·현 재고·사용 재고·이후 재고·목적 및 출하담당·비고·소유·유상무상·사용처 / 입고: 입고 칸 / 수량 변경: 종류·변동·담당·상대). `entryTitle` 과 `sheetOf` 가 가른다.
- **사람 이름은 라벨을 붙여 보인다**: 확인을 거친 건은 「신청자: ○○ · 확인자: ○○」, 바로 적은 건은 「기록자: ○○」(2026-10-06 사용자: 이름만 나란히 두면 가시성이 떨어짐). 기록 내역·상세 창 이력·확인 대기 묶음 모두.
- **기록 번호 글자는 `US-2026-84`** 꼴(시트 영문 두 글자 + 연도 + 순번, `sheetNoText`). 맨 숫자만 쓰면 견적서 번호와 겹쳐 보인다(2026-10-06 사용자). DB 에는 연도·순번만 있고 글자는 화면이 만든다.
- **엑셀 한 벌 관련 화면 용어(2026-10-12 사용자 결정 — 「단어가 너무 어렵다」).** 화면에서는: 치워 둔 파일 → **「수기입 파일」**(처음 「사람이 고친 파일」로 했다가 사용자가 바꿈), 상태 「사람이 손대 멈춤」 → **「엑셀 수기입시 멈춤」**(위 「수기입 파일」이 무엇인지 연상되게), 파일 크기는 **KB/MB**(`src/lib/file-size.ts` `formatFileSize`, B 단위 금지), 한 벌 → **「현황판 엑셀」**(「다음 차례에 한 벌을 다시 씁니다」 → 「1분 안에 현황판 엑셀을 다시 만듭니다」), [한 벌 사본 내려받기] → **[사본 내려받기]**, 「그때 크기 · 지문」 → **「현재 파일 크기」**(sha256 은 title 로만), 프로그램 기준본 → **「기준 파일」**, 틀 → **「양식 파일」**(틀과 기준본을 둘 다 「기준 파일」로 부르면 다른 두 파일이 한 이름이 되므로 가름), 백업 「N벌」 → 「N개」. 문서·코드·파일 이름(`현황판_사람수정_*`, `baseline/`, PARKED)은 그대로 — 바뀐 것은 화면 글자뿐.
- **화면 용어 「필터」**(2026-10-06 사용자 결정). 문서의 「거르기」는 화면에서는 「필터」로 쓴다. 조건 지우기 단추 이름은 그대로.
- **화면 이름 「기록 취소」**(처음엔 바로잡기, 2026-10-06 사용자 결정). 코드값 `CORRECTION`·감사 행위 `STOCK_CORRECTION` 은 그대로. 반환과 다르다 — 반환은 실물이 돌아오는 것, 기록 취소는 잘못 적은 줄을 되돌리는 것.
- **화면 이름 「변경 이력」**(처음엔 고친 이력). 등록·삭제·로그인 기록도 들어 있어 사용자 요청으로 바꿈. 주소 `/audit`·표 `audit_logs` 는 그대로.
- **`"use server"` 파일은 async 함수만 내보낸다.** 상수(처음 상태)·객체를 export 하면 `next build` 가 "found object" 로 깨진다. 타입 export 는 된다. 처음 상태 상수는 폼 조각이 갖는다.
- **DB 로직을 브라우저 없이 돌려 보려면** `node --conditions=react-server --import tsx scripts/<파일>.ts`. `server-only` 가 react-server 조건에서 빈 모듈로 풀린다. 스크립트는 **저장소 안**에 두고 상대 경로로 import(절대 Windows 경로는 ESM 이 못 읽음), 최상위 await 금지(CJS).
- **데모 자료와 실자료를 가르는 장치**: 데모 부품은 품명이 「예시 」로 시작하고, `db:seed-demo` 는 parts 가 비어 있을 때만 돈다. 데모를 지우는 명령은 없다 — 개발 DB 를 통째로 다시 만든다(`npm run db:down -- -v`). 실자료는 조각 5 의 가져오기 스크립트만 넣는다.
- **찾기 입력 칸과 주소의 q 동기화**: 입력은 로컬 state, 200ms 뒤 주소로. 주소의 q 가 바뀌어 돌아올 때 **우리가 방금 민 값이면 입력 칸을 건드리지 않는다**(사람이 그 사이 더 친 글자를 지우지 않으려고). effect 안 setState 는 eslint(react-hooks/set-state-in-effect)가 막으므로 렌더 중 파생 상태 방식.
- **`@dss/ui` 는 서브모듈 소스를 그대로 컴파일한다.** `tsconfig.json` paths 두 줄(`@dss/ui` → `vendor/dss-ui/src/index.ts`, `@dss/ui/styles.css` → `service-menu/service-menu.css`)로 잇는다. `exclude: ["vendor"]` 는 그대로 둔다 — import 로 끌려오는 파일은 어차피 컴파일되고, 서브모듈의 테스트 파일까지 이 저장소 tsc 에 들어오지 않게 막는 역할이다. 서브모듈 포인터를 올릴 때는 묶음(dss-ui) 커밋을 먼저 올린다.

---

## 1. 배경 — 이 시스템은 독립 프로젝트가 아니다

같은 회사에 **DSS 통합 로그인 포털(`dss-auth`)** 이 이미 운영 중이다.
카카오 로그인으로 사원을 인증하고, 승인된 사원에게 사내 시스템 목록을 보여주는 앱이다.
이 재고관리 시스템은 그 포털 뒤에 붙는 **다섯 번째 사내 시스템**이 된다.

```
                        [ 카카오 ]
                            ^
                            | dss-auth가 카카오의 클라이언트
                            |
        +-----------------------------------------+
        |   dss-auth : 통합 로그인 포털   포트 3100 |
        |-----------------------------------------|
        |  users                사원 명단          |
        |  clients              연결된 시스템       |
        |  user_client_grants   접근 허가 + 역할    |
        |  /apps                시스템 런처         |
        +-----------------------------------------+
                            |
                            | OIDC (Authorization Code + PKCE)
        +---------+---------+---------+------------+
        |         |         |         |            |
        v         v         v         v            v
    A/S 관리   계측기 관리  개선요청   PO·내자      재고관리
     (3000)     (3300)    (3500)   (3600, 예정)  (3800, 이것)
```

> 🔴 **포트는 3800이다.** 처음 배정된 3700은 휴가 관리 시스템이 쓰고 있어 2026-10-06에 정정됐다
> (`포털등록값_2026-10-06.md`). 3700·5448이 코드에 남아 있으면 틀린 것이다.

**이 구조에서 나오는 결론 셋 — 전부 이 문서의 근거다.**

1. **로그인을 만들지 않는다.** 이 시스템은 OIDC 클라이언트가 되어 dss-auth에 위임한다.
2. **신원도 역할도 포털이 준다.** 누가 우리 회사 사람인지, 이 시스템에서 어떤 역할인지를
   포털이 ID 토큰에 실어 보낸다.
3. **데이터베이스는 이 시스템 전용이다.** dss-auth의 DB에도, A/S의 DB에도 접속하지 않는다.

지금 어긋난 채로 만들면 나중에 인증을 처음부터 다시 짜고 DB를 갈아엎어야 한다.
지금 맞추면 추가 비용이 0이다. **이 문서의 규칙은 협상 대상이 아니다.**

---

## 2. 🔴 이 시스템이 대체하는 것 — 가장 먼저 알아야 할 사실

**재고관리는 A/S 관리 시스템(`RF_Service_System`) 안에 이미 있다.**
약 18,300줄 · 표 12개 규모로 돌아가고 있다.

**확정된 결정** (담당자, 2026-09-21):

1. 이 새 시스템이 **그것을 대체한다.** 단, **DB는 합치지 않고 새로 만든다.**
   (개선요청 기능이 `dss-improvements`로 떨어져 나간 것과 같은 길이다)
2. **화면은 그대로 옮기는 것이 아니라 새로 설계한다.** 기존 것은 참고만 한다.
3. 🔴 **A/S에 지금 들어 있는 재고 자료는 전부 버린다.** 옮겨오지 않는다.
   그쪽 부품 76개는 실제 자료가 아니다.
4. 🔴 **이 시스템에 들어가는 재고 목록과 재고 현황이 회사의 진짜 자료가 된다.**
   NAS에 올라가 실제로 쓰이는 것은 이쪽이다.

### 2-0. 🔴 이 시스템은 정본(正本)이다 — 설계의 무게가 달라진다

4번이 이 프로젝트의 성격을 정한다. 연습용이 아니라 **회사가 실제로 믿고 쓸 숫자**를 담는다.
그래서 다음이 "나중에 해도 되는 것"이 아니라 **1차부터 지켜야 할 것**이 된다.

- **수량이 바뀐 이유를 항상 남긴다.** 11절의 원장(append-only) 구조는 선택이 아니다.
  숫자만 덮어쓰면 "왜 이 숫자가 됐는가"에 영원히 답할 수 없다.
- **지운 것이 실제로 지워지지 않게 한다.** 소프트 삭제 4컬럼 고정(11절).
- **누가 언제 무엇을 했는지 감사 로그에 남긴다.**
- **백업이 없으면 실데이터를 넣으면 안 된다.** 다만 백업 설정은 NAS 쪽 일이라
  **담당자가 한다.** 🔴 **설계서에 「이 시스템의 DB와 업로드 폴더를 야간 백업 대상에
  추가해야 한다」를 반드시 적어 올려라** — 사내 다른 시스템에서 이 한 줄을 빠뜨려
  한 번도 백업되지 않을 뻔한 적이 있다.
- **시드/데모 데이터와 실제 자료를 명확히 갈라 둔다.** 데모를 지우는 명령이 실자료를
  건드리지 않게 만든다.

### 2-1. 이미 있는 것 — 모르고 설계하면 반드시 충돌한다

🔴 **사용자가 "나중에 붙일 것"이라고 말하는 세 가지는 A/S에 이미 같은 이름으로 존재한다.**

| 화면 | A/S에서의 경로 |
|---|---|
| 재고 목록 · 부품 상세 | `/inventory`, `/inventory/[id]` |
| **부품 요청 관리** | `/inventory/requests` |
| **승인 요청건** | `/inventory/approvals` |
| **O/H 부품 템플릿** | `/inventory/oh-templates` |

즉 담당자가 나중에 붙일 것은 **새로 만드는 것이 아니라 옮겨오는 것**일 가능성이 높다.
→ **1차에서는 만들지 않는다. 다만 표와 화면 구조에 자리를 비워 둔다.** (REQUIREMENTS 7절 「나중에 붙이는 것」 — 요청·확인은 결재선 없이, 프리셋이 O/H 템플릿 자리를 맡는다)

### 2-2. 🔴 혼자 결정하지 말고 담당자에게 보고할 것 셋

**자료를 버리기로 했으므로 이관 문제는 없다.** 그래도 아래는 이 시스템 하나로 결정할 수 없다.
**설계서에 「담당자 확인 필요」로 적어 올린다.**

1. **부품 마스터의 주인이 이 시스템으로 옮겨온다 — 그러면 A/S의 견적서는 어디를 보나.**
   지금 A/S의 `parts`에는 **견적서(`quote_items`)** · O/H 템플릿 · 수리건 사용부품이
   FK로 매달려 있고, 곧 갈라져 나갈 **`dss-po`(견적서)도 `parts`를 읽는다.**
   이 시스템이 정본이 되면 **A/S에 남는 그 참조들을 어떻게 할지**가 남는다
   (DB가 다르므로 FK로는 못 잇는다 — API로 잇거나, 필요한 조각만 사본으로 두거나).
   → 이 프로젝트 최대의 미결 사항이다. **답이 오기 전에 A/S 쪽을 건드리지 마라.**
2. **수리건 ↔ 부품 요청 연결을 끊어도 되는가.**
   지금은 엔지니어가 수리 건 상세에서 부품을 요청한다. 재고를 떼어내면 그 흐름이 끊긴다.
3. **결재선을 어떻게 할 것인가.**
   A/S의 `shipment_approval_routes` 한 표를 **출하승인 · 부품불출 · 견적서결재**가
   `scope`로 나눠 쓴다. 승인을 가져오면 이 표도 갈라야 한다. (2차 이후 문제지만 지금 알아야 한다)

🔴 **이 셋의 답을 기다리느라 1차를 멈추지는 마라.** 셋 다 「이 시스템 바깥」의 문제다.
목록 · 등록 · 입출고 기록까지는 답 없이도 만들 수 있다. 다만 **부품을 가리키는 식별자를
바깥에 내줄 수 있는 모양**(사람이 읽을 수 있고 안 바뀌는 값)으로 정해 두면 나중이 쉬워진다.

### 2-3. 지켜야 할 경계

- 🔴 **이웃 저장소를 고치지 않는다.** A/S · 계측기 · 개선요청 · 포털은 **읽기만** 한다
  (본뜰 것을 보러). 손댈 일이 생기면 직접 하지 말고 보고한다.
- **A/S의 재고 화면을 지우는 일은 이 프로젝트가 하지 않는다.** 새 시스템이 실제로
  돌기 시작한 뒤, 담당자가 별도로 결정한다.

---

## 3. 기술 스택 — 고정이다

다른 사내 시스템과 **동일한 스택**으로 새로 만든다.
사용자가 다른 스택을 원하면 아래 "왜 고정인가"를 설명한 뒤 **사용자의 결정을 따르되
그 결정을 `REQUIREMENTS.md`에 기록**한다.

| 항목 | 지정 |
|---|---|
| 프레임워크 | **Next.js 16.3.x** (App Router. Pages Router 금지) |
| UI | **React 19.2.x** |
| 언어 | **TypeScript 5.x** (`strict: true`) |
| DB | **PostgreSQL 17** (이 시스템 전용 DB 하나) |
| ORM | **Drizzle ORM 0.45.x** + `drizzle-kit 0.31.x` (Prisma 금지) |
| PG 드라이버 | `postgres` 3.4.x |
| JWT 검증 | **`jose` 6.x** (`jsonwebtoken` 금지 — dss-auth도 `jose`를 쓴다) |
| 스타일 | **Tailwind CSS 4** (설정 파일 없이 CSS에 `@theme`) |
| 패키지 매니저 | **npm** (yarn / pnpm 금지) |
| 테스트 | **`node --test` + `tsx`** (Jest / Vitest 금지) |

**왜 고정인가:** 다섯 시스템이 같은 NAS 한 대에 같은 방식으로 올라가야 하고,
담당자가 필요할 때 직접 코드를 손볼 수 있어야 한다.

**추가 라이브러리는 넣기 전에 반드시 물어라.** 특히 다음은 원칙적으로 금지다:

- **네이티브 바이너리를 요구하는 라이브러리** — `sharp` · `canvas` · `bcrypt` · `argon2` ·
  `puppeteer` 등. NAS(Synology DS218+, Linux) Docker 이미지 빌드가 깨지는 주된 원인이다.
  해시가 필요하면 **`node:crypto` 내장 `scrypt`** 를 쓴다.
- **인증 라이브러리** — NextAuth.js · Auth.js · Clerk · Supabase Auth 등. 5절 참조.
- **UI 컴포넌트 라이브러리 · 아이콘 라이브러리** — 9절 참조. 사내 시스템은 쓰지 않는다.

### ⚠️ Next.js 16은 네가 아는 Next.js가 아니다

**이건 실제로 겪은 문제다.** Next.js 16에는 학습 데이터와 다른 파괴적 변경이 있다 —
API도, 관례도, 파일 구조도 다를 수 있다.

- **코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 가이드를 먼저 읽어라.**
- 지원 중단(deprecation) 경고를 무시하지 마라.
- 기억에 의존해 옛 API를 쓰지 마라. 예전 방식으로 썼다가 조용히 깨지는 경우가 있다.

**빌드 참고:** 회사 PC의 보안 정책이 Next의 네이티브 SWC 바이너리를 차단해 Turbopack이
안 도는 사례가 있다. 그래서 사내 시스템은 전부 **`next dev --webpack` · `next build --webpack`**
을 `package.json`에 박아 둔다. 처음부터 그렇게 넣어라.

---

## 4. 베낄 기준 저장소 — `dss-improvements`

사내에서 **가장 최근에, 지금 규약으로만 지어진** 시스템이다. 골격을 여기서 가져온다.
(소스를 받지 않고 진행해도 된다. 필요하면 담당자에게 요청한다)

| 가져올 것 | `dss-improvements`의 자리 |
|---|---|
| 의존성 목록 | `package.json` (10개뿐이다) |
| 루트 레이아웃 | `src/app/layout.tsx` |
| 인증 구간 레이아웃 | `src/app/(app)/layout.tsx` |
| 로그인 화면 | `src/app/(public)/login/page.tsx` |
| 머리말 | `src/components/AppHeader.tsx` |
| **OIDC 연동 4파일** | `src/lib/auth/{oidc,session,guards,service-menu-cookie}.ts` |
| SSO 라우트 3개 | `src/app/api/auth/sso/{start,callback,backchannel-logout}/route.ts` |
| 전역 CSS | `src/app/globals.css` |
| 환경변수 예시 | `.env.example` |
| Dockerfile · `.dockerignore` · 개발용 `docker-compose.yml` | 루트 |

화면 패턴(목록 · 표↔카드 전환 · 페이지네이션 · 배지 · 저장 알림)은 **A/S 시스템**이
카탈로그다. 다만 **폰트만은 A/S의 것(Geist)을 쓰지 않는다** — 9절 참조.

---

## 5. 로그인 — 절대 만들지 말 것

**이 시스템에 자체 로그인을 만들지 마라.** 아래는 전부 dss-auth의 몫이다.

- 회원가입 화면 · 회원가입 API — 금지
- 비밀번호 저장 · 해싱 · 검증 · 재설정 · 찾기 — 금지
- 계정 잠금 · 실패 횟수 관리 — 금지
- **카카오 로그인을 여기서 직접 연동 — 금지.** 카카오와 이야기하는 것은 dss-auth 하나뿐이다.
  여기서 따로 붙이면 같은 사람이 두 개의 서로 다른 신원으로 갈라진다.
- 사용자 승인 · 계정 관리 화면 — 금지 (포털 `/admin/users`가 담당)
- NextAuth.js · Auth.js · Clerk · Supabase Auth 도입 — 금지

**대신 할 일은 6절 하나뿐이다: OIDC 클라이언트가 되는 것.**

---

## 6. 로그인 — OIDC 클라이언트로 붙는 방법

**포털은 이미 완성되어 있고, 세 시스템이 실제로 이 방식으로 붙어 돌고 있다.**
가짜 로그인을 만들 필요가 없다.

### 6-1. 엔드포인트

`{issuer}`는 `SSO_ISSUER` 값이다. **끝에 슬래시를 붙이지 않는다.**

| 용도 | 주소 |
|---|---|
| Discovery | `{issuer}/.well-known/openid-configuration` |
| JWKS | `{issuer}/.well-known/jwks.json` |
| authorize | `{issuer}/api/oidc/authorize` |
| token | `{issuer}/api/oidc/token` |
| userinfo | `{issuer}/api/oidc/userinfo` |
| 로그아웃 | `{issuer}/api/oidc/logout` |
| 앱 런처(사람용) | `{issuer}/apps` |

### 6-2. 흐름

```
1. 로그인 안 된 사용자가 보호된 화면에 접근
2. 이 시스템 → {issuer}/api/oidc/authorize 로 리다이렉트
   (client_id, redirect_uri, response_type=code, scope=openid profile email,
    state, nonce, code_challenge, code_challenge_method=S256)
3. 포털이 카카오 로그인 → 승인 상태 확인 → 접근 허가 확인
4. 포털 → 이 시스템의 redirect_uri 로 되돌아옴 (code, state)
5. 이 시스템의 **서버**가 {issuer}/api/oidc/token 에
   grant_type=authorization_code & code & redirect_uri & code_verifier
   & client_id & client_secret 을 form-urlencoded 로 제출
6. ID 토큰(JWT) 수신 → 검증 → 이 시스템의 자체 세션 쿠키 발급
```

### 6-3. 반드시 지킬 규칙

- **PKCE 필수. `code_challenge_method`는 `S256`만.** `plain`은 지원하지 않는다.
- **`nonce` 필수.** 없으면 `/authorize`에서 거절당한다.
- **`state`도 반드시 보내고, 돌아온 값을 대조한다.** (CSRF 방어)
- **인가 코드는 60초 · 1회용.** 재사용이 감지되면 그 사용자의 토큰이 전부 폐기되고
  감사 로그에 남는다.
- **리프레시 토큰이 없다.** 세션이 만료되면 `/authorize`로 한 번 다녀오면 된다
  (포털 세션이 살아 있으면 사용자에게 아무것도 묻지 않고 통과한다).
- **엔드포인트 주소를 하드코딩하지 마라.** discovery 문서를 읽어 쓰고 짧게 캐싱한다.
- **`code_verifier`·`state`·`nonce`를 나르는 방법**: DB 테이블을 새로 만들지 말고
  **서명된 짧은 수명 쿠키**(10분)를 쓴다. 서명하지 않으면 사용자가 `code_verifier`를
  바꿔치기해 PKCE를 무력화할 수 있다.

### 6-4. ID 토큰 검증 — 하나라도 빠뜨리면 안 된다

받은 ID 토큰은 **JWT(RS256)** 다. `jose`로 아래를 **전부** 확인한다.

```ts
const { payload } = await jwtVerify(idToken, jwks(), {
  issuer: env.ssoIssuer,        // 끝 슬래시까지 정확히 일치해야 한다
  audience: env.ssoClientId,
  clockTolerance: 30,
});
// 🔴 nonce 는 jose 가 보지 않는다. 직접 대조해야 한다.
if (payload.nonce !== expectedNonce) return null;   // 빼면 ID 토큰 재사용 구멍
if (typeof payload.sub !== "string" || payload.sub === "") return null;
```

JWKS는 **한 번 만들어 재사용**한다(`jose`가 캐시와 키 교체를 처리한다). 단 `next build`가
환경변수 없이 돌아야 하므로 **지연 생성**한다:

```ts
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks() {
  jwksCache ??= createRemoteJWKSet(new URL(`${env.ssoIssuer}/.well-known/jwks.json`));
  return jwksCache;
}
```

`alg`가 `RS256`인지 확인한다. **`none`이나 `HS256`을 받아들이면 안 된다.**
검증에 실패하면 **예외를 밖으로 던지지 말고 로그인 실패로 처리**한다.
사용자에게 상세 사유를 보여주지 않는다.

### 6-5. ID 토큰에 실려 오는 것

```jsonc
{
  "iss": "...", "aud": "<client_id>", "iat": 0, "exp": 0,  // 수명 300초
  "sub": "<UUID>",              // 🔴 사람을 잇는 유일한 영구 식별자
  "sid": "...", "nonce": "...", "auth_time": 0,
  "name": "홍길동",
  "preferred_username": "홍길동",
  "email": "...",               // 🔴 값이 있을 때만. 없으면 키 자체가 없다
  "email_verified": false,      // 항상 false — 신원 판단에 쓰지 마라
  "role": "ADMIN",              // 🔴 지정됐을 때만. 없으면 키 자체가 없다
  "dss_services": [ { "id": "...", "name": "...", "url": "...", "icon": "📦" } ]
}
```

- 🔴 **부서 · 사번은 실려 오지 않는다.** 포털 `users` 표에 칸은 있지만 클레임으로 나가지 않는다.
  필요하면 포털을 고쳐야 하므로 **담당자에게 보고**한다.
- 🔴 **`email`과 `role`은 "없으면 키 자체가 없다".** "안 왔다"와 "빈 값"을 구분해야 한다.
- `userinfo`는 `sub` · `name` · `email`만 돌려준다. **`role`과 `dss_services`는 없다.**
  ID 토큰이 사실상의 정보원이다.

### 6-6. `sub` — 사람을 식별하는 유일한 값

🔴 **이메일로 사람을 식별하지 마라.** 포털의 `email`은 **없을 수 있고**(카카오에서 선택 동의),
사용자가 언제든 바꿀 수 있다. 이름도 마찬가지다. **`sub`만이 안정적이다.**

- `sub`를 자기 DB에 `auth_sub` 한 칸으로 저장하고 **UNIQUE 인덱스**를 건다.
  모든 사용자 관련 데이터를 여기에 건다.
- 이메일 · 이름은 **화면 표시용으로만** 쓰고, 로그인할 때마다 최신값으로 갱신한다.
- 🔴 **이메일이 같다고 기존 계정을 주워가지 마라.** A/S는 그런 경우 로그인을 거절하고
  사람이 따로 잇게 한다.

### 6-7. 이 시스템의 세션

ID 토큰을 검증한 뒤에는 **이 시스템만의 세션 쿠키**를 발급한다.
포털의 `dss_sso` 쿠키를 읽으려 하지 마라 — 그건 포털 것이고 도메인이 다르면 보이지도 않는다.

- 🔴 **쿠키 이름은 이 시스템 고유값으로 한다** (13절). **쿠키는 포트를 가리지 않는다** —
  다른 시스템과 같은 이름을 쓰면 한쪽 로그인이 다른 쪽을 덮는다. A/S에서 실제로 났던 구멍이다.
- 쿠키 옵션: `httpOnly: true`, `sameSite: "lax"`, `path: "/"`,
  **`secure`는 HTTPS일 때만 true.** 사내망 HTTP 단계에서 켜면 쿠키가 저장되지 않아
  **로그인이 조용히 실패**한다. → `SESSION_COOKIE_SECURE` 환경변수로 가른다.
- 세션 수명은 포털 SSO 세션(**절대 만료 12시간**)을 넘기지 않는다.
- **세션을 읽는 코드는 파일 하나에만 둔다.** 화면·API 곳곳에서 쿠키를 직접 읽지 마라.

### 6-8. 🔴 로그아웃 — 둘 중 하나만 빼도 조용히 깨진다

포털에서 로그아웃하면 이 시스템의 세션도 **즉시** 끊겨야 한다. 그러려면 **둘 다** 필요하다.

1. **백채널 로그아웃 수신부** (`/api/auth/sso/backchannel-logout`).
   포털이 `logout_token`을 POST로 보낸다. **누구나 두드릴 수 있으므로 서명 검증이 전부다.**
   `nonce`가 있으면 거절(ID 토큰 밀어넣기 방지), `events`에
   `http://schemas.openid.net/event/backchannel-logout` 필수, 성공은 **204**.
2. **`users.sessions_valid_from` 칸.** 백채널 로그아웃이 그 선을 올리고,
   매 요청마다 그보다 먼저 발급된 토큰을 거절한다.

**둘 중 하나라도 빠지면 포털에서 로그아웃해도 이 시스템은 계속 열려 있다.**
같은 이유로 세션 조회에서 DB 읽기를 "성능"으로 걷어내지 마라.

---

## 7. 주소 — 이제 고칠 곳이 없다

포털은 `redirect_uri`를 **문자 단위 정확 일치**로 검증한다. 와일드카드도, 접두사 일치도,
정규화도 없다. 끝 슬래시 하나만 달라도 거절된다.

예전에는 Wi-Fi가 바뀔 때마다 등록값을 고쳐야 했지만 **지금은 해결되어 있다.**

**이 프로젝트는 `auto`를 쓰지 않는다.** 포털이 이 PC가 아니라 **담당자 PC**(`192.168.1.132:3100`)에 있기 때문이다.
담당자가 등록해 준 값을 그대로 쓴다(2026-10-06):

- `SSO_ISSUER=http://192.168.1.132:3100` — 담당자 PC의 개발 포털. 끝 슬래시 없음.
- `SSO_REDIRECT_URI=http://localhost:3800/api/auth/sso/callback` — `localhost`라 이 PC의 주소가 바뀌어도 안 깨진다.
  **브라우저 주소도 `http://localhost:3800`으로 열어야 한다**(`127.0.0.1`이나 LAN IP로 열면 돌아올 때 글자가 달라 거절된다).

> 담당자 PC의 주소가 Wi-Fi 사정으로 바뀌면 **다른 건 다 멀쩡한데 로그인만 막힌다.** 그때는 고치려 애쓰지 말고
> 담당자에게 새 주소를 받아 `SSO_ISSUER` 한 줄만 고친다. 로그인 화면이 아예 안 뜨면 담당자 PC의 포털이 꺼진 것이다.
> NAS 운영에서는 담당자가 `https://inventory.dss21.co.kr` 기준으로 다시 등록하고 환경변수를 바꾼다.

---

## 8. 사용자와 권한

### 8-1. 2층 구조

1. **"우리 회사 사람인가"** — 포털의 `users.status` (`PENDING` / `ACTIVE` / `SUSPENDED`).
   카카오로 처음 들어오면 `PENDING`이고, 포털 관리자가 승인해야 `ACTIVE`가 된다.
2. **"이 시스템을 쓸 사람인가"** — 포털의 `user_client_grants`.
   `clients.requires_grant = false`면 이 행 없이도 전 직원이 통과한다.

즉 **"이 시스템을 쓸 사람인가"는 포털이 걸러 준다.**
이 시스템은 **"넘어온 사람이 이 안에서 무엇을 할 수 있는가"** 만 판정하면 된다.

### 8-2. 역할은 포털이 실어 보낸다

🔴 **역할은 사용자가 아니라 「부여 행」에 붙는다.** 한 사람이 A/S에서는 `SALES`,
재고관리에서는 `ADMIN`일 수 있다. 포털은 역할 문자열의 유효성을 검사하지 않는다 —
**받는 시스템이 자기 목록과 대조해야 한다.**

`decideRole` 판정을 **반드시 이대로** 만든다:

| 들어온 값 | 처리 |
|---|---|
| `role` 클레임이 **없음** | **KEEP** — 기존 역할을 유지한다 |
| **아는 값** | **APPLY** — 포털 값으로 로컬 역할을 덮어쓴다 |
| **모르는 값** | 🔴 **REJECT — 로그인을 거절한다** |

**왜 REJECT인가**: 관리자가 *강등*하려다 오타를 내면, 유지(KEEP)는 높은 권한을
조용히 남긴다. 그게 fail-open이다. 거절하면 시끄럽게 실패하고 사람이 알아챈다.

아는 값 목록은 **포털에 등록한 `available_roles`와 반드시 일치해야 한다.**

### 8-3. 역할 목록은 이 시스템이 정한다

🔴 **A/S 시스템의 역할(`SUPER_ADMIN` · `ADMIN` · `AS_ENGINEER` · `SALES` ·
`INVENTORY_MANAGER`)을 그대로 베끼지 마라.** 그건 그 시스템의 역할이다.
이 시스템의 역할은 **`VIEWER` · `STAFF` · `ADMIN`** 으로 확정되어 포털에 등록되어 있다(REQUIREMENTS 10절). 코드값은 `src/db/schema/users.ts` 의 `ROLES`.

### 8-4. 판정은 항상 서버에서

- **클라이언트가 보낸 `sub` · 역할 · 사용자 ID를 절대 믿지 마라.**
  폼 필드 · 쿼리스트링 · 요청 본문에 담겨 온 값으로 권한을 판정하면 안 된다.
- 가드 함수(`requireSession()` · `requireRole(...)`)를 만들어 그것만 호출한다.
- **세션 검증은 `(app)/layout.tsx` 한 곳에서** 한다. 🔴 **다만 데이터를 바꾸는
  서버 액션 · API는 따로 다시 검증한다** — 레이아웃은 화면을 그릴 때만 돈다.
- 화면에서 버튼을 숨기는 것은 UI 편의일 뿐이다. **실제 차단은 반드시 서버에서** 한다.

---

## 9. 화면 — 기존 사내 시스템과 같게 만든다

직원들이 하루에도 여러 시스템을 오간다. **화면이 따로 놀면 안 된다.**
사내 시스템은 UI 라이브러리를 쓰지 않고 **같은 클래스 문자열을 반복**하는 방식으로 통일한다.

### 9-1. 🔴 쓰지 않는 것 (넣지 마라)

| 안 쓰는 것 | 대신 |
|---|---|
| shadcn/ui · MUI · Radix · Headless UI | 아래 관용구 클래스를 직접 쓴다 |
| **아이콘 라이브러리**(lucide · heroicons · react-icons) | **한글 텍스트 라벨.** 꼭 필요하면 인라인 `<svg>` |
| `cn()` · `clsx` · `tailwind-merge` | 템플릿 리터럴로 직접 잇는다 |
| `tailwind.config.js/ts` | **파일이 없다.** Tailwind 4는 `globals.css`의 `@theme` |
| `next/font` (Google Fonts) | 시스템 폰트 스택 — 빌드가 네트워크를 타면 NAS 배포에 불리하고, 한글에는 어차피 적용되지 않는다 |
| React Query · SWR · axios · redux · zustand | **서버 컴포넌트에서 직접 await + Server Actions.** 상태는 `useState` + URL searchParams |
| 무한 스크롤 | 표 + 페이지네이션 |

**기본은 서버 컴포넌트다.** 상호작용이 필요할 때만 `"use client"`로 내린다.

### 9-2. `globals.css` — 이대로 시작한다

```css
@import "tailwindcss";

:root { color-scheme: light; }   /* 사무실 PC에서 표를 읽는 화면이다. 밝게 고정 */

@theme inline {
  --font-sans: "Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI",
               "Malgun Gothic", "맑은 고딕", sans-serif;
  --font-mono: "Cascadia Mono", "Consolas", "D2Coding", ui-monospace, monospace;
}

html, body { height: 100%; }
body {
  background: #f1f5f9;
  color: #0f172a;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/* 🔴 지우지 마라. Tailwind preflight 의 margin:0 이 브라우저 기본 margin:auto 를
   지워서, 이게 없으면 모든 팝업이 화면 왼쪽 위 구석에 붙는다. */
dialog { margin: auto; }

@media (max-width: 30rem) {
  dialog:modal { width: calc(100% - 2rem); }
}

/* 숫자를 세로로 맞춰 읽는다 — 수량·금액 칸에 쓴다 */
.tabular { font-variant-numeric: tabular-nums; }
```

### 9-3. 관용구 — 이 문자열을 그대로 쓴다

중립색은 **`zinc`** 를 쓴다(사내 다수파).

```
카드/패널     rounded-lg border border-zinc-200 bg-white p-4

주 버튼       rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white
              hover:bg-zinc-800 disabled:opacity-50

보조 버튼     rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700
              hover:bg-zinc-100 disabled:opacity-50

위험 버튼     rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white
              hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50

배지          inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
              whitespace-nowrap

표 머리글     bg-zinc-50 text-left text-xs text-zinc-500
표 행         border-b border-zinc-100 last:border-0 hover:bg-zinc-50

폼 라벨       flex flex-col gap-1 text-xs text-zinc-500      (라벨 텍스트가 자식)
입력          rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900

다이얼로그    w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-4
              text-zinc-900 backdrop:bg-black/40

제목 H1       text-xl font-semibold text-zinc-900
섹션 H2       text-sm font-semibold text-zinc-900
빈 상태       rounded-lg border border-zinc-200 bg-white p-8 text-center
              text-sm text-zinc-500
```

- **주 버튼은 화면당 하나**를 원칙으로 한다.
- **모달은 네이티브 `<dialog>` + `showModal()`.** 라이브러리를 쓰지 않는다.
  `useRef<HTMLDialogElement>` + `useEffect`로 열림을 동기화하고,
  `onCancel`에서 `preventDefault()` 후 닫기 처리를 한다.
- **빈 상태 문구는 필터 유무에 따라 다르게** 쓴다
  (`"이 조건으로 등록된 품목이 없습니다."` vs `"아직 등록된 품목이 없습니다."`).

### 9-4. 레이아웃 — 머리말형

화면이 스무 개를 넘기기 전까지는 사이드바를 만들지 않는다.

```
src/app/layout.tsx                ← <html lang="ko"> + globals.css + "@dss/ui/styles.css"
src/app/(public)/login/page.tsx   ← 세션 없이 보는 화면
src/app/(app)/layout.tsx          ← requireSession() 한 곳 + 머리말
src/app/actions/                  ← "use server"
src/app/api/auth/sso/             ← OIDC 라우트 3개
```

```tsx
// src/app/(app)/layout.tsx
<div className="flex min-h-full flex-col">
  <AppHeader
    user={user}
    portalUrl={portalAppsUrl()}
    serviceMenu={
      <ServiceMenuBar
        services={services}
        currentServiceId={SSO_CLIENT_ID}
        variant="inline"
      />
    }
  />
  <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6">{children}</main>
</div>
```

머리말은 `border-b border-zinc-200 bg-white` + 안쪽에
`mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-3`.
오른쪽에 **「통합 로그인으로」** 버튼을 둔다 — 포털 런처(`/apps`)로 가며,
로그아웃과 달리 **세션을 끊지 않는다.**

### 9-5. 시스템 오가기 메뉴바 — `@dss/ui`

사내 시스템을 오가는 드롭다운이다. **공용 패키지를 git 서브모듈로 가져온다.**

```bash
git submodule add https://github.com/kiri190-me/dss-ui.git vendor/dss-ui
```

- `tsconfig.json`의 `paths`에 `"@dss/ui": ["./vendor/dss-ui/src/index.ts"]`
- `eslint.config.mjs`의 ignores에 `vendor/dss-ui/**`
- 루트 레이아웃에서 `import "@dss/ui/styles.css"`
- 서브모듈로 가져오는 이유: Dockerfile이 `COPY . .` 라 **저장소 폴더 안**에 있어야
  이미지에 담긴다.

```tsx
import { ServiceMenuBar, normalizeServiceMenu } from "@dss/ui";

const services = normalizeServiceMenu(claims.dss_services);
<ServiceMenuBar services={services} currentServiceId={MY_CLIENT_ID} variant="inline" />
```

🔴 **`variant="inline"`에서는 `currentServiceId`를 꼭 넘긴다.** 안 넘기면
드롭다운 단추에 「지금 어느 시스템에 있는지」가 사라진다.
목록은 ID 토큰의 `dss_services` 클레임에서 오므로, **별도 서명 쿠키에 담아 두고** 쓴다.

### 9-6. 로그인 화면

🔴 **아이디/비밀번호 입력란이 없다.** 세션이 없으면 곧장 `/api/auth/sso/start`로 보낸다.
`/login`은 **거절 사유를 보여줄 때만** 쓰고, 거기서는 자동으로 다시 보내지 않는다
(무한 왕복이 된다). 에러 코드 → 한국어 문구 표를 상수로 둔다.

### 9-7. 목록 화면 규약 (이 시스템의 중심 화면이다)

- **표 + 페이지네이션.** `[10, 20, 50]건` 선택 + `"전체 N건 중 a-b건"` + 이전/다음.
- 검색·필터는 **URL searchParams**에 담고 `router.replace`로 갱신한다(뒤로가기가 동작한다).
- 상태는 **배지 + 텍스트 라벨을 함께** 쓴다. 색만으로 구분하지 않는다(색약 고려).
- 수량·금액 칸에는 `.tabular`를 쓴다.
- 인쇄가 필요하면 `globals.css`에 `@media print`로 `.no-print` / `.print-only`를 둔다.

---

## 10. 한국어 문구 규약

- **어체는 하십시오체(`~습니다`).** 빈 상태 · 오류 · 확인 문구 모두. `~해요`체는 쓰지 않는다.
- **버튼 · 메뉴는 명사형** (`저장` · `등록` · `입고` · `출고` · `이전` · `다음`).
- 필수 입력은 라벨 옆에 ` *` (예: `품명 *`).
- 라벨은 **입력 필드 위**에 둔다.
- 🔴 **영어 개발자 메시지(스택 트레이스 · 원시 예외 · 테이블명)를 사용자 화면에 절대 노출하지 마라.**
  모든 오류는 한국어 사용자 문구로 바꾼다.
- 식별자 · DB명 · API 경로 · 함수명은 **영어**. 화면 표시만 한국어.
- **용어를 섞어 쓰지 마라.** 인터뷰에서 정한 말을 화면 전체에서 똑같이 쓴다
  (`품목`인지 `부품`인지, `수량`인지 `재고`인지 하나로 정한다).

### 날짜 · 숫자

🔴 **`timeZone: "Asia/Seoul"`을 항상 명시한다.** 운영 서버(NAS)가 UTC이기 때문이다.

```ts
// 표시용
new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
})                                                        // 2026. 09. 21.

// 저장·비교용 (YYYY-MM-DD 문자열이 필요할 때)
new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", /* … */ })   // "2026-09-21"
```

건수는 `N건`, 페이지 크기는 `10건`으로 쓴다.

---

## 11. 데이터베이스 규칙

| 항목 | 규칙 |
|---|---|
| 테이블명 | **snake_case + 복수형** — `parts`, `stock_transactions` |
| 컬럼명 | **snake_case** |
| 기본키 | **UUID** (자동증가 정수 금지) |
| 시각 컬럼 | `created_at` · `updated_at` — **timestamp with time zone** |
| 삭제 | **물리 삭제 금지. 소프트 삭제 4컬럼 고정** |

**소프트 삭제 4컬럼(이름·개수 고정)**:
`is_deleted`(boolean) / `deleted_at`(timestamptz null) / `deleted_by`(uuid null) /
`delete_reason`(text null)

- `is_deleted`에 **부분 인덱스**: `WHERE is_deleted = false`
- 중요한 행위(생성 · 수정 · 삭제 · 복원 · 로그인 · 입출고 · 승인)는 **감사 로그에 남긴다.**
  감사 로그는 **append-only** — UI로 개별 레코드를 지울 수 있게 만들지 마라.

### 🔴 재고에 특히 중요한 설계 원칙

**수량의 정본은 「원장」이고, 현재고는 그 투영이다.**

- 입고 · 사용 · 반환 · 조정을 **부호 있는 증감 기록(append-only)** 으로 쌓는다.
  그 기록은 **수정하지도, 지우지도 않는다.** 잘못 넣었으면 되돌리는 기록을 새로 쌓는다.
- 현재 수량은 그 합계를 **캐시로 들고 있는 표**로 둔다(빠른 목록 조회용).
  `현재수량 >= 0` 을 **DB 제약(CHECK)** 으로 건다.
- 수량을 바꾸는 일은 **원장 기록과 캐시 갱신을 한 트랜잭션 안에서** 한다.
- 이유: 재고는 "지금 몇 개인가"보다 **"왜 그 숫자가 됐는가"** 를 더 자주 따진다.
  숫자만 덮어쓰는 구조는 그 질문에 영원히 답할 수 없다.

### 마이그레이션

- 항상 `npx drizzle-kit generate`로 생성한다. **생성된 SQL을 손으로 고치지 마라.**
- 적용(`migrate`) · 데이터 변경은 **사용자 승인 후에만** 실행한다.
- 기존 데이터를 삭제하거나 초기화하는 명령을 **임의로 실행하지 마라.**

---

## 12. NAS 제약 — 지금 지키면 공짜다

최종 운영 환경은 **Synology DS218+ NAS의 Linux Docker 컨테이너**다.
지금은 개발 PC에서만 돌리지만 **모든 설계가 아래를 만족해야 한다.**
나중에 고치려면 DB 전 행을 수정하고 파일을 전부 이름 바꿔 옮겨야 한다.

### 12-1. 파일 경로 6대 규칙

1. **절대경로를 DB에 저장하지 않는다.** 저장 루트는 환경변수, DB에는 **상대경로만**.
   `C:\...` 같은 값은 컨테이너 안에 존재하지 않는다.
2. **경로 구분자는 항상 `/`로 저장한다.** DB에 넣을 경로를 만들 때 `path.join()`을 쓰지 마라.
   Windows에서 역슬래시가 섞이면 Linux는 그 전체를 **폴더 하나의 이름**으로 읽는다.
   `path.join`은 **실제 파일시스템에 닿는 함수 딱 하나**에서만 쓴다.
3. **대소문자를 구분한다고 가정한다.** 경로 · UUID는 전부 **소문자로 통일**해 저장한다.
4. **디스크 파일명에 한글 · 공백 · 특수문자 · 원본 파일명을 쓰지 않는다.**
   저장 파일명은 **UUID + 확장자**, 원본 파일명은 **DB 메타데이터로만** 보관한다.
5. **호스트 절대경로를 코드에 하드코딩하지 않는다.**
6. **실행 환경 값(포트 · DB 접속정보 · 저장 루트 · issuer · client_secret)은 전부 환경변수.**
   🔴 **없으면 조용히 기본값으로 넘어가지 말고 명확히 throw한다.**
   인증과 파일 저장에서 "설정이 빠졌는데 그럭저럭 동작하는" 상태가 가장 위험하다.

### 12-2. 컨테이너화 준비

- `next.config.ts`에 **`output: "standalone"`**.
- 루트에 **`Dockerfile`** — `ARG NODE_IMAGE=node:22-bookworm-slim`, 멀티스테이지
  (deps → builder → **tools** → runner).
  🔴 **`tools` 스테이지를 `runner` 앞에 둔다.** 마지막 스테이지가 `docker build`의
  기본 대상이라, 뒤에 두면 앱 대신 도구 이미지가 구워진다.
- `.dockerignore`에 `node_modules` · `.next` · **`.env*`**.
- 서버가 **`0.0.0.0`** 에 바인딩되게 한다(`ENV HOSTNAME=0.0.0.0`).
- 포트는 `process.env.PORT`를 따른다.
- 개발용 DB는 **`docker compose`** 로 띄운다.
  🔴 `docker compose`는 `.env`만 자동으로 읽고 **`.env.local`은 읽지 않는다.**
  `package.json` 스크립트에 `--env-file .env.local` 을 반드시 넣어라.
  빠뜨리면 비밀번호가 빈 값이 되어 DB 컨테이너가 재시작 루프에 빠진다.

### 12-3. 스크립트와 메모리

- **앱이 도는 곳에서 PowerShell을 쓰지 않는다.** Linux 컨테이너에 PowerShell이 없다.
  배치 · 정리 · 시드 스크립트는 **TypeScript(`tsx`로 실행)** 로 작성한다.
  (개발 PC를 켜고 끄는 편의 스크립트는 예외다 — 이미지에 들어가지 않는다)
- 파일 업로드는 **메모리에 통째로 올리지 말고 스트림으로 처리**한다.
  `request.formData()`는 파일 전체를 메모리에 올린다. **DS218+는 RAM이 작다.**

### 12-4. 배포는 이 프로젝트가 하지 않는다

🔴 **운영 배포는 담당자가 한다.** NAS 접속 · 이미지 전송 · compose 수정 · 리버스 프록시
설정을 **직접 수행하지 마라.** 필요하면 **절차와 명령어만 문서로 작성해 제공**한다.

---

## 13. 이 시스템에 배정된 값

| 항목 | 값 |
|---|---|
| `client_id` | **`dss-inventory`** (담당자 확정 · 포털 등록 끝, 2026-10-06) |
| 개발 · 컨테이너 포트 | **3800** (3000 A/S · 3100 포털 · 3200 홈페이지 · 3300 계측기 · 3400 출석부 · 3500 개선요청 · 3600 PO · **3700 휴가**). ~~3700~~은 2026-10-06 정정 |
| NAS 호스트 포트 | `127.0.0.1:13800` (담당자가 씀) |
| 개발 DB 포트 | **5450** (~~5448~~은 휴가 관리의 DB가 쓴다. 2026-10-06 정정) |
| DB 이름 | `dss_inventory_dev` (개발) |
| 세션 쿠키 | `inventory_session` |
| 로그인 왕복 쿠키 | `inventory_sso_tx` (`/api/auth/sso` 경로에만 붙인다) |
| 메뉴바 쿠키 | `inventory_service_menu` |
| 운영 주소(나중) | `https://inventory.dss21.co.kr` |

### 환경변수 (`.env.example`에 **이름만** 두고 `.env.local`에 값을 채운다)

```
DATABASE_URL=postgres://dss_inventory_app:CHANGE_ME@127.0.0.1:5450/dss_inventory_dev
DEV_POSTGRES_PASSWORD=          # docker-compose 가 읽는 값. 위 비밀번호와 같아야 한다
PORT=3800

AUTH_SESSION_SECRET=            # 32자 이상. node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
SESSION_COOKIE_SECURE=false     # HTTPS 를 붙인 뒤에 true
SESSION_HOURS=12                # 포털 SSO 세션 절대만료 12시간을 넘기지 않는다

SSO_ISSUER=http://192.168.1.132:3100          # 담당자 PC의 개발 포털 (7절)
SSO_CLIENT_ID=dss-inventory
SSO_CLIENT_SECRET=              # 포털 발급(개발용). 한 번만 표시된다. 운영용은 다른 값
SSO_REDIRECT_URI=http://localhost:3800/api/auth/sso/callback
SSO_TX_SECRET=                  # 32자 이상. 🔴 AUTH_SESSION_SECRET 과 다른 값
```

- 🔴 `SSO_CLIENT_SECRET`에 **`NEXT_PUBLIC_` 접두사를 붙이지 마라** — 브라우저로 새어나간다.
- `.env.local`은 **git에 커밋하지 말고, 내용을 화면에 출력하지도 마라.**
- 🔴 `AUTH_SESSION_SECRET`을 바꾸면 **이미 나가 있는 세션이 전부 무효**가 된다.

---

## 14. 담당자에게 확인받아야 할 것

아래는 이 시스템 단독으로 결정할 수 없다. **`REQUIREMENTS.md`에 목록으로 적어 올린다.**

> 2026-10-06 현재: 1(셋 다 답 받음 — REQUIREMENTS 10절 1~3) · 3(등록 끝) · 4(지정된 사람만) · 5(VIEWER/STAFF/ADMIN) · 6(3800/5450) 은 끝났고,
> **2(야간 백업)** 는 담당자가 걸고 확인해 주기로 했다 — 그 전에는 실제 자료를 넣지 않는다.

1. **2절의 「보고할 것 셋」** — 부품 마스터가 이쪽으로 넘어오면 A/S 견적서는 어디를 보나 /
   수리건↔부품요청 연결 / 결재선. **가장 중요하다.**
2. 🔴 **야간 백업 대상에 이 시스템의 DB와 업로드 폴더를 넣어 달라고 요청한다**(2-0절).
   **실자료가 들어가는 시스템이다.** 백업이 걸리기 전에 실제 재고를 채우지 않는 편이 좋다.
3. **포털 클라이언트 등록.** ✅ **2026-10-06 담당자가 끝냈다**(`포털등록값_2026-10-06.md`): `client_id=dss-inventory`,
   redirect `http://localhost:3800/api/auth/sso/callback`, 역할 `VIEWER`·`STAFF`·`ADMIN`, 지정된 사람만, 정영빈=`ADMIN`.
   운영 주소와 백채널 로그아웃 URI는 NAS로 옮길 때 담당자가 다시 등록한다. 참고로 담당자가 쓰는 명령은 이런 모양이다:
   ```bash
   npm run client:register -- \
     --client-id dss-inventory --name "재고 관리" \
     --redirect-uri 'http://localhost:3800/api/auth/sso/callback' \
     --post-logout-redirect-uri 'http://localhost:3800/login' \
     --backchannel-logout-uri 'http://localhost:3800/api/auth/sso/backchannel-logout' \
     --launcher-url 'http://localhost:3800/' --launcher-icon 📦 \
     --role VIEWER --role STAFF --role ADMIN
   ```
   🔴 **중괄호는 작은따옴표로 감싼다**(셸이 건드리면 등록값이 깨진다).
   🔴 **`--open-to-all`을 주지 않으면 매번 `requires_grant`가 `true`로 되돌아간다.**
   다른 인자는 안 주면 기존 값을 유지하는데 이것만 예외다 — 전 직원 공개로 두기로 했다면
   **등록값을 고칠 때마다 `--open-to-all`을 함께 줘야 한다.**
   🔴 **시크릿은 발급 시 한 번만 보인다.** 해시만 저장하므로 복구가 원리상 불가능하고,
   잃어버리면 `--rotate`로 재발급뿐이다. **메신저·메일로 평문 전송하지 마라.**
4. **`requires_grant`를 켤 것인가** — 지정된 사람만 들어오게 할 것인가,
   승인된 직원 전원에게 열 것인가.
5. **역할 목록 확정** — `VIEWER` · `STAFF` · `ADMIN` 으로 확정됨.
6. **`client_id` · 포트 확정** (13절 값이 그대로면 그렇다고 확인만 받는다).

---

## 15. 작업 규칙

- 코드 · 파일을 수정하기 **전에** 변경 대상과 계획을 먼저 설명하고 **승인**을 받는다.
- 한 번에 **하나의 기능만** 작업한다.
- 기존에 동작하던 기능을 **임의로 삭제하지 않는다.**
- **이웃 저장소를 고치지 않는다.** 읽기만 한다.
- `.env` · `.env.local`을 **git에 커밋하지 말고, 내용을 화면에 출력하지도 마라.**
- 실제 고객 정보 · 비밀번호 · API 키 · `client_secret`을 외부 서비스로 전송하지 마라.
- **마이그레이션 적용 · 데이터 변경 · git push는 사용자 승인 후에** 한다.
- **운영 배포는 직접 수행하지 않는다.** 절차와 명령어만 작성해 제공한다.
- 테스트 데이터와 실제 데이터를 명확히 분리한다.
- 🔴 **주석에 「왜 그렇게 했는가」를 적는다.** 이 회사 저장소들의 공통 특징이고,
  실제로 같은 함정을 두 번 밟지 않게 해 준 장치다. 무엇을 하는지가 아니라
  **무엇을 하지 않기로 했고 그 이유가 무엇인지**를 남긴다.
- SQL은 **반드시 Drizzle의 파라미터 바인딩**으로. 문자열을 이어붙여 쿼리를 만들지 마라.
- 사용자 입력을 `dangerouslySetInnerHTML`에 넣지 마라.
- 상태를 바꾸는 요청(POST · PUT · DELETE)은 **요청 출처(Origin)를 검증**한다.

---


## 부록 A. 기존 A/S 재고 도메인 — 참고용 사실

**소스를 받아올 필요는 없다. 아래 요약만 보고, 인터뷰에서 "이렇게 하고 있는데 바꿀까요?"를
물을 때 쓴다.** 그대로 베끼라는 뜻이 아니다 — 화면은 새로 설계한다.

### 화면 (5개)

| 화면 | 하는 일 |
|---|---|
| 재고 목록 | 부품 마스터 전체를 표로. 목록이 작아 **한 번에 다 받아 화면에서 검색·필터**한다 |
| 부품 상세 | 소유×위치별 잔량표, 입출고 이력, 단가·최소수량, 입고/사용/반환 팝업 |
| 부품 요청 관리 | 올라온 요청을 출고 · 거부 · 보류 · 부분마감 |
| 승인 요청건 | 부품 불출 결재 — 「내가 결재할 건 · 실행할 건 · 진행 중인 신청」 |
| O/H 부품 템플릿 | 기종별 오버홀 표준 부품 목록. 제품 모델·재고 부품과 연결 |

### 표 (주요한 것)

- `parts` — 부품 마스터. 품명 · 품명2 · 교산품번 · 도면번호 · 분류 · 구분 · 노무비
  🔴 **유니크 제약이 하나도 없다.** "믿을 만한 식별 키가 없다"는 실측에 따른 **의도적 결정**이다.
  → 이번 설계의 답: UNIQUE 로 막지 않고 등록 때 경고만(같은 이름의 부품이 따로 있어야 하는 경우가 실제로 16묶음). 바깥에 내주는 열쇠는 No.
- `part_stock_balances` — `(부품, 소유, 위치)` 유니크. 현재수량(캐시), `>= 0` CHECK
- `stock_transactions` — **원장(append-only)**. 부호 있는 증감 · 유형(입고/사용/반환) ·
  수리건 연결 · 되돌림 연결(반환은 반드시 특정 사용을 되돌린다)
- `inventory_part_requests` (+ 줄 · 출고회차 · 이력) — 요청. 상태 7가지
- `inventory_part_issue_requests` (+ 줄 · 결재) — 불출 결재
- `oh_part_templates` (+ 줄 · 기종) — O/H 템플릿
- `part_minimum_quantities` — 소유구분별 최소수량(부족 알림 근거)
- `part_unit_prices` · `part_overhaul_unit_prices` — 단가 / O/H 단가

### 알아둘 값과 결정

- **소유 구분은 4개 고정** — `DSS` / `KYOSAN`(교산) / `SERVICE_SPARE`(서비스예비) / `TEST`(테스트)
- **위치는 마스터 표 없이 사람이 손으로 치는 자유 텍스트**
- 개발 PC 기준 **부품 76개**, (부품×소유) 조합 82개, 전부 위치 1개씩.
  🔴 **이 자료는 버린다. 옮겨오지 않는다.** 규모가 이 정도라는 감을 잡는 용도로만 본다 —
  「목록이 작아 한 번에 다 받아 화면에서 거른다」는 그쪽 설계의 근거가 이 숫자다.
- 🔴 **승인이 끝나도 재고가 자동으로 빠지지 않는다.** 승인은 「해도 된다」까지이고
  실행은 재고 담당자가 따로 누른다. 그래서 상태에 `APPROVED`와 `EXECUTED`가 따로 있다.
  (2026-09-10 사용자 확정 설계)
- 🔴 **O/H 템플릿은 부품 13개가 상한.** 고장이 아니라 안전장치다 —
  OH 견적서 엑셀 양식의 부품 칸이 13줄(34~46행)이기 때문. 상한만 늘리면
  저장은 되지만 견적서에서 부품이 조용히 잘린다.
- 🔴 **부품 사용 기록이 두 갈래다.** 재고를 움직이는 `stock_transactions`(USE)와,
  재고를 전혀 건드리지 않고 **사람이 손으로 적는** 「이 건에서 뭘 갈았나」 표가 따로 있다.
  후자가 생긴 이유: 수리 건 216건 중 부품 요청 기록이 있는 건이 **36건(17%)** 뿐이라
  통계가 나오지 않았다. → **"실제로 무슨 부품이 나갔나"의 답이 두 군데에 나뉘어 있다.**
  이번 설계에서 이걸 하나로 합칠 것인지 물어라.
- **`parts`를 바깥에서 참조하는 것**: 견적서 품목 · O/H 템플릿 줄 · 수리건 사용부품 ·
  잔량표. → 2절의 「부품 마스터의 주인」 문제의 실체다.
