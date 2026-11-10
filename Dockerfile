FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci

FROM dependencies AS builder
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ARG API_PROXY_TARGET=http://api:4000/api
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV API_PROXY_TARGET=$API_PROXY_TARGET
ENV DATABASE_URL=$DATABASE_URL
RUN npm run build

FROM builder AS production-dependencies
RUN npm prune --omit=dev

FROM builder AS migrate
ENV NODE_ENV=production
ENV HOME=/tmp/runtime-home
RUN mkdir -p /tmp/runtime-home && chown -R node:node /tmp/runtime-home
USER node
CMD ["npm", "run", "db:deploy"]

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
ENV HOME=/tmp/runtime-home
RUN apk add --no-cache libreoffice font-liberation poppler-utils tesseract-ocr tesseract-ocr-data-spa tesseract-ocr-data-eng \
  && mkdir -p /app/storage /app/tmp/mcp-downloads /tmp/runtime-home \
  && chown -R node:node /app/storage /app/tmp /tmp/runtime-home
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=builder /app/apps/api/templates ./apps/api/templates
COPY --chown=node:node --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --chown=node:node --from=builder /app/packages/database ./packages/database
COPY --chown=node:node --from=builder /app/packages/domain/dist ./packages/domain/dist
COPY --chown=node:node --from=builder /app/packages/domain/package.json ./packages/domain/package.json
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/scripts/import-legal-library.mjs ./scripts/import-legal-library.mjs
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
ENV API_PROXY_TARGET=http://api:4000/api
COPY --chown=node:node --from=builder /app/apps/web/.next/standalone ./
COPY --chown=node:node --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node --from=builder /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
FROM api AS railway