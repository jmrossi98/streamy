# ---- Builder ----
FROM node:20-alpine AS builder

WORKDIR /app

# Limit Node heap to avoid OOM kill (exit 137) on low-memory builders
ENV NODE_OPTIONS=--max-old-space-size=2048

# Deps layer (cache bust only when package files change)
# Use npm install so build works when lock file is missing or out of sync.
# For reproducible builds: run "npm install" locally, commit package-lock.json, then use "npm ci" here.
# Copy prisma so postinstall (prisma generate) can find prisma/schema.prisma
COPY package.json package-lock.json* ./
COPY prisma ./prisma
# Retry npm install to handle transient network errors (ECONNRESET) in CI
RUN for i in 1 2 3; do npm install --no-audit --no-fund && break; sleep 20; done

COPY . .
# Ensure public exists so runner COPY succeeds (Next.js may not have a public/ in repo)
RUN mkdir -p public

# Prisma generate + DB URL for build only (no real data).
ENV DATABASE_URL="file:./build.db"
ENV TMDB_API_KEY="build-placeholder"
ENV NODE_ENV=production

# Edge Middleware inlines these at `next build`. They MUST match runtime (.env on server) or JWT / getToken breaks.
# Pass from CI: --build-arg NEXTAUTH_SECRET=... --build-arg NEXTAUTH_URL=... (same values as production secrets).
ARG NEXTAUTH_SECRET
ARG NEXTAUTH_URL
ENV NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
ENV NEXTAUTH_URL=${NEXTAUTH_URL}

RUN npx prisma generate && npm run build

# ---- Runner (minimal: standalone, no npm ci) ----
# Use Debian slim so we can install libssl1.1 for Prisma engine (Alpine 3.17+ has OpenSSL 3 only)
FROM node:20-bullseye-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl1.1 \
    ca-certificates \
    util-linux \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 nextjs

# Next.js standalone: server + traced deps (includes Prisma client from build)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Prisma CLI only for migrate (optional; skip for fastest startup)
RUN npm install prisma --no-save --ignore-scripts

# Don't USER nextjs here: migrate runs as root (needs write to node_modules), then we run app as nextjs
EXPOSE 3000

# Run migrate as root when RUN_MIGRATE=1, then start app as nextjs (runuser avoids permission errors)
# Migrate as root; SQLite file must be writable by nextjs (Prisma at runtime)
CMD ["sh", "-c", "mkdir -p /app/data && if [ \"$RUN_MIGRATE\" = '1' ]; then npx prisma migrate deploy; fi && chown -R nextjs:nodejs /app/data && exec runuser -u nextjs -- node server.js"]
