# Orchestrator service — rate-limit state, circuit breakers, gap detection.
# Same monorepo-aware pattern as the gateway Dockerfile.
#
# Build context: repo root. On Railway:
#   Root Directory = "/"
#   Dockerfile Path = "packages/orchestrator/Dockerfile"

# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json        ./packages/shared/
COPY packages/orchestrator/package.json  ./packages/orchestrator/
COPY packages/normaliser/package.json    ./packages/normaliser/
COPY packages/gateway/package.json       ./packages/gateway/
COPY packages/mcp-fleet/package.json     ./packages/mcp-fleet/
COPY packages/live-window/package.json   ./packages/live-window/
COPY packages/sdk/package.json           ./packages/sdk/
COPY packages/platform/package.json      ./packages/platform/
RUN pnpm install --frozen-lockfile

FROM deps AS run
COPY . .
ENV NODE_ENV=production
EXPOSE 3006
CMD ["pnpm", "exec", "tsx", "packages/orchestrator/src/main.ts"]
