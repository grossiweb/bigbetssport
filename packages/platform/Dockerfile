# --- builder --------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /repo
RUN corepack enable

COPY pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY packages/platform      ./packages/platform
COPY packages/shared        ./packages/shared
COPY packages/orchestrator  ./packages/orchestrator
COPY packages/sdk           ./packages/sdk

RUN pnpm install --frozen-lockfile --filter @bbs/platform...
RUN pnpm --filter @bbs/platform build:next

# --- runner ---------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs
USER nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/packages/platform/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/packages/platform/.next/static      ./packages/platform/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/packages/platform/public            ./packages/platform/public

EXPOSE 3001
CMD ["node", "packages/platform/server.js"]
