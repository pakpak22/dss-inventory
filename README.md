# dss-inventory — DSS 재고 관리

부품 재고·입고·사용 기록을 관리하는 사내 웹 시스템. DSS 통합 로그인 포털(`dss-auth`) 뒤에 붙는다.
자세한 규칙과 현황은 `CLAUDE.md`, 요구 사항은 `REQUIREMENTS.md`, 설계는 `DESIGN.md`.

## 시작하기 (개발 PC)

```bash
npm install
cp .env.example .env.local      # 값을 채운다. 시크릿은 담당자에게 USB 로 받는다. 출력하지 말 것.
npm run db:up                   # Docker Desktop 필요. PostgreSQL 17 → 127.0.0.1:5450
npm run db:migrate              # drizzle/ 의 SQL 적용 (사용자 승인 뒤)
npm run dev                     # http://localhost:3800
```

- 브라우저는 **`http://localhost:3800`** 으로 연다. 포털에 등록된 돌아오는 주소가 `localhost` 라 다른 주소로 열면 로그인이 거절된다.
- 로그인 화면은 담당자 PC 의 개발 포털(`SSO_ISSUER`)이다. 안 뜨면 그 PC 가 꺼진 것이고, 어제까지 되던 로그인만 막히면 주소가 바뀐 것이다 → 담당자에게.

## 명령

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (webpack, 포트 3800) |
| `npm run build` / `npm start` | 운영 빌드 / 실행 |
| `npm test` | `node --test` 단위 테스트 (DB 없이 돈다) |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run db:up` / `db:down` / `db:logs` | 개발 DB 컨테이너 |
| `npm run db:generate` | 스키마 → 마이그레이션 SQL (`drizzle/`) |
| `npm run db:migrate` | 마이그레이션 적용 |

## 포트

| | 포트 |
|---|---|
| 앱 (개발·컨테이너) | **3800** |
| 개발 DB | **5450** |
| NAS 호스트 (담당자) | 13800 |

3700·5448 은 휴가 관리 시스템이 쓴다. (2026-10-06 정정)

## 운영 배포

담당자가 한다. `Dockerfile`(deps → builder → tools → runner, standalone)과 `docker-compose.yml`(개발 DB)이 재료다.
운영 주소 `https://inventory.dss21.co.kr` 등록, 백채널 로그아웃 URI 등록, 야간 백업(DB·데이터 폴더·엑셀 틀 두 벌)은 NAS 로 옮길 때 담당자가 한다.
