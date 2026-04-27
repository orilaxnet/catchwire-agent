FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++ sqlite

# ─── deps ────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# ─── build ───────────────────────────────────────────────────────────────────
FROM base AS builder
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ src/
COPY public/ public/
RUN npm run build 2>/dev/null || true   # skip if no build step (ESM direct run)

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/src          ./src
COPY --from=builder /app/public       ./public 2>/dev/null || true
COPY package.json tsconfig.json ./

VOLUME ["/app/data"]

EXPOSE 3000 2525

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "--experimental-specifier-resolution=node", "--loader", "ts-node/esm", "src/main.ts"]
