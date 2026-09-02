# ---------------------------------------------------------------------------
# OurRankTracker production image.
#
# Multi-stage: dependencies, build, then a slim runtime that carries only the
# Next.js standalone server output.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app


# --- dependencies ----------------------------------------------------------
FROM base AS deps
# openssl is required by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci


# --- build -----------------------------------------------------------------
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next build` runs the env schema, so give it placeholders. Real values are
# supplied at runtime — nothing here is baked into the image.
ENV DOCKER_BUILD=1
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV SESSION_SECRET="build-time-placeholder-value-not-used-at-runtime"

RUN npx prisma generate && npm run build

# A self-contained Prisma CLI for `migrate deploy` at container start.
# The CLI has transitive dependencies scattered across node_modules, so
# cherry-picking @prisma/* directories into the runtime image does not work.
# Installing it into its own prefix keeps the dependency tree complete and
# cannot collide with the application's own modules. The version is read from
# package.json so the two can never drift.
RUN mkdir -p /opt/prisma-cli \
    && cd /opt/prisma-cli \
    && npm init -y > /dev/null \
    && npm install --no-audit --no-fund \
        "prisma@$(node -p "require('/app/package.json').devDependencies.prisma")"


# --- runtime ---------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Schema and migrations, plus the self-contained CLI that applies them.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /opt/prisma-cli /opt/prisma-cli

# The generated Prisma client, which the application itself uses at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
