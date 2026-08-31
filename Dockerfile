# ---- Builder (must match runner OS for Prisma: both Debian bullseye) ----
FROM node:20-bullseye-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl1.1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_OPTIONS=--max-old-space-size=4096
ENV NEXT_TELEMETRY_DISABLED=1

# --- Dependency layer (cached unless package*.json changes) ---
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN for i in 1 2 3; do npm install --no-audit --no-fund && break; sleep 20; done

# --- Source layer ---
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

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# The migrate CLI, copied rather than installed. `npm install prisma` here cost
# 1.01GB of the image -- and almost none of it was Prisma. Next's standalone
# output above already ships the node_modules it traced, so running npm in that
# directory re-resolved the whole of package.json and reinstalled next,
# @next/swc, hls.js and the rest on top of it, then left 647MB of npm's own
# cache behind in the same layer. All to obtain an 11MB CLI that the builder
# stage already has. That gigabyte was pulled onto the server on every single
# deploy (and two concurrent pulls of it once wedged the instance).
#
# @prisma above carries the schema-engine binary this needs; the copy is inert
# at runtime and only runs when RUN_MIGRATE=1 (see CMD).
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

EXPOSE 3000

# Prisma is invoked by its real entry point, not `npx prisma`. npx resolves via
# node_modules/.bin, which npm used to create here; copying the package (above)
# doesn't, and npx's fallback is to *fetch* prisma from the registry at boot --
# turning container start into a network dependency that fails closed on a bad
# link. The direct path has no such fallback: it either exists or the container
# tells us immediately.
CMD ["sh", "-c", "mkdir -p /app/data /app/.next/cache && if [ \"$RUN_MIGRATE\" = '1' ]; then node node_modules/prisma/build/index.js migrate deploy; fi && chown -R nextjs:nodejs /app/data /app/.next/cache && exec runuser -u nextjs -- node server.js"]
