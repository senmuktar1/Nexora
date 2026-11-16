# NEXORA — production container (Next.js standalone server on Node.js 22)
# Build:  docker build -t nexora .
# Run:    docker run -p 3000:3000 --env-file .env.production nexora

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S nexora && adduser -S nexora -G nexora
COPY --from=build --chown=nexora:nexora /app/.next/standalone ./
COPY --from=build --chown=nexora:nexora /app/.next/static ./.next/static
COPY --from=build --chown=nexora:nexora /app/public ./public
USER nexora
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
