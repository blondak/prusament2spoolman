# Build with Docker Buildx for linux/amd64 and linux/arm64.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY frontend ./frontend
COPY server ./server
COPY shared ./shared
RUN npm run build

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
RUN npm cache clean --force

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/blondak/prusament2spoolman"
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 8080
CMD ["npm", "start"]
