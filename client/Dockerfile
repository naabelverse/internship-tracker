# syntax=docker/dockerfile:1

# Shared dependency layer. The build context is the repo root so npm workspaces
# can resolve both packages from a single lockfile.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci

# Development image used by docker-compose: Vite serves on 0.0.0.0 so the port
# publish reaches the host.
FROM deps AS dev
COPY tsconfig.base.json ./
COPY client ./client
ENV NODE_ENV=development
EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace", "client"]
