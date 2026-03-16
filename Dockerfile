# ---- Builder ----
FROM node:20-alpine AS builder

WORKDIR /app

# Limit Node heap to avoid OOM kill (exit 137) on low-memory builders
ENV NODE_OPTIONS=--max-old-space-size=2048

# Deps layer (cache bust only when package files change)
# Use npm install so build works when lock file is missing or out of sync.
# For reproducible builds: run "npm install" locally, commit package-lock.json, then use "npm ci" here.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

ARG DATABASE_URL
ARG TMDB_API_KEY
ARG NEXTAUTH_SECRET
ARG NEXTAUTH_URL
ENV DATABASE_URL="${DATABASE_URL}"
ENV TMDB_API_KEY="${TMDB_API_KEY}"
ENV NEXTAUTH_SECRET="${NEXTAUTH_SECRET}"
ENV NEXTAUTH_URL="${NEXTAUTH_URL}"
ENV NODE_ENV=production

RUN npx prisma generate && npm run build

# ---- Runner (minimal: standalone, no npm ci) ----
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next.js standalone: server + traced deps (includes Prisma client from build)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Prisma CLI only for migrate (optional; skip for fastest startup)
RUN npm install prisma --no-save --ignore-scripts

USER nextjs

EXPOSE 3000

# Fast: start only. Run migrations in CI or set RUN_MIGRATE=1 to run on boot.
CMD ["sh", "-c", "if [ \"$RUN_MIGRATE\" = '1' ]; then npx prisma migrate deploy; fi && node server.js"]
