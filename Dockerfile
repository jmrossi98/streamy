# ---- Builder (must match runner OS for Prisma: both Debian bullseye) ----
# Alpine + Debian runtime = wrong Query Engine in standalone trace; use Debian for both.
FROM node:20-bullseye-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl1.1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_OPTIONS=--max-old-space-size=2048

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN for i in 1 2 3; do npm install --no-audit --no-fund && break; sleep 20; done

COPY . .
RUN mkdir -p public

ENV DATABASE_URL="file:./build.db"
ENV TMDB_API_KEY="build-placeholder"
ENV NODE_ENV=production

ARG NEXTAUTH_SECRET
ARG NEXTAUTH_URL
ENV NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
ENV NEXTAUTH_URL=${NEXTAUTH_URL}

RUN npx prisma generate && npm run build

# ---- Runner ----
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

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Standalone trace can miss Prisma engine files — copy full client from builder (Debian engine).
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

RUN npm install prisma --no-save --ignore-scripts

EXPOSE 3000

CMD ["sh", "-c", "mkdir -p /app/data && if [ \"$RUN_MIGRATE\" = '1' ]; then npx prisma migrate deploy; fi && chown -R nextjs:nodejs /app/data && exec runuser -u nextjs -- node server.js"]
