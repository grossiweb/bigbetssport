# Gateway service — Fastify REST/GraphQL/WebSocket.
# Railway / Fly.io / Render compatible. Runs from the monorepo root so
# pnpm can resolve workspace: deps (@bbs/orchestrator, @bbs/shared, etc.).
#
# Build context: the repo root (set Root Directory = "/" on Railway and
# Dockerfile Path = "packages/gateway/Dockerfile").

# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

# ---- deps ----
# Copy lockfile + every workspace package.json so `pnpm install` can run
# without pulling the whole source tree (keeps this layer cacheable).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json        ./packages/shared/
COPY packages/orchestrator/package.json  ./packages/orchestrator/
COPY packages/normaliser/package.json    ./packages/normaliser/
COPY packages/gateway/package.json       ./packages/gateway/
COPY packages/mcp-fleet/package.json     ./packages/mcp-fleet/
COPY packages/live-window/package.json   ./packages/live-window/
COPY packages/sdk/package.json           ./packages/sdk/
COPY packages/platform/package.json      ./packages/platform/
RUN pnpm install --frozen-lockfile

# ---- runtime ----
FROM deps AS run
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "exec", "tsx", "packages/gateway/src/main.ts"]
