# NAS(Synology DS218+, Linux) 운영용 이미지. 배포는 담당자가 한다 — 이 파일은 그 절차의 재료다.
# 네이티브 바이너리를 요구하는 패키지가 없어야 이 빌드가 NAS 에서 깨지지 않는다. (CLAUDE.md 3·12절)
ARG NODE_IMAGE=node:22-bookworm-slim

# ── 1. deps: 의존성만 설치 ────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. builder: next build ──────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 빌드는 환경변수 없이 돌아야 한다 — src/lib/env.ts 가 값을 "지연" 해석하는 이유.
RUN npm run build

# ── 3. tools: 마이그레이션·배치 스크립트 실행용 (tsx 포함) ─────────────────────
# 🔴 runner 보다 앞에 둔다. 마지막 스테이지가 docker build 의 기본 대상이라
#    뒤에 두면 앱 대신 도구 이미지가 구워진다. (CLAUDE.md 12-2절)
FROM ${NODE_IMAGE} AS tools
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src/db ./src/db
COPY src/lib/env.ts ./src/lib/env.ts
CMD ["npx", "tsx", "scripts/migrate.ts"]

# ── 4. runner: 실제로 도는 이미지 (standalone) ───────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# 0.0.0.0 에 바인딩해야 컨테이너 밖에서 닿는다. 포트는 PORT 환경변수를 따른다.
ENV HOSTNAME=0.0.0.0
ENV PORT=3800
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3800
CMD ["node", "server.js"]
