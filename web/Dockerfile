# GhostKeep web — Next.js standalone output: no npm, no devDeps at runtime.
FROM node:20-alpine AS builder
WORKDIR /build
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . ./
# Baked into client JS at build time — pass your LAN/domain API URL here.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=256
ENV PORT=3000
# Standalone bundle keeps npm-workspace layout (server at web/server.js).
COPY --from=builder /build/.next/standalone ./
COPY --from=builder /build/.next/static ./web/.next/static
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1
CMD ["node", "web/server.js"]
