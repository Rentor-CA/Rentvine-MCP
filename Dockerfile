# OPTIONAL — not how this is deployed. Rentor runs the server under pm2 behind
# nginx (see "Install" in the README); nothing in that path builds this image.
# It is here for anyone who wants to run the server somewhere else.
#
# The HTTP server in a container: `docker build -t rentvine-mcp .`, then run it
# with RENTVINE_API_KEY, RENTVINE_API_SECRET, RENTVINE_COMPANY and
# MCP_AUTH_TOKEN (it refuses to start on 0.0.0.0 without a token).
# Endpoints: /mcp (all tools), /mcp/read, /mcp/write, /health — see src/http.ts.
#
# Run it with `--init`: nothing in the server handles SIGTERM, so as PID 1 it
# ignores `docker stop` until the grace period runs out and it is SIGKILLed.
# HOST/PORT below are defaults — override with -e; EXPOSE is only metadata.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "dist/http.js"]
