# Production images for the hosted beta (compose.prod.yaml). Targets: api, web.
FROM node:24.22.1-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @ai-job-hunter/api build
# Hosted build: hides local-only features (whisper.cpp transcription, bookmarklet).
RUN VITE_HOSTED=1 pnpm --filter @ai-job-hunter/web build

FROM base AS api
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter @ai-job-hunter/api
COPY --from=build /app/apps/api/dist apps/api/dist
# CV PDF export fonts.
COPY apps/api/assets apps/api/assets
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM caddy:2.10.2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
