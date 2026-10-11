# GhostKeep backend — lean multi-stage image.
# Build tools (argon2 native compile) stay in the builder; the runtime ships
# only dist/ + production deps on alpine.
FROM node:20-alpine AS builder
WORKDIR /build
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && npm cache clean --force

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Cap V8 heap so one VPS box never gets eaten by a runaway process.
ENV NODE_OPTIONS=--max-old-space-size=384
COPY --from=builder /build/package.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "dist/index.js"]
