# The HTTP server in a container: `docker build -t rentvine-mcp .`, then run it
# with RENTVINE_API_KEY, RENTVINE_API_SECRET, RENTVINE_COMPANY and
# MCP_AUTH_TOKEN (it refuses to start on 0.0.0.0 without a token).
# Endpoints: /mcp (all tools), /mcp/read, /mcp/write, /health — see src/http.ts.

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
