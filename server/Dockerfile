# syntax=docker/dockerfile:1

# Shared dependency layer. The build context is the repo root so npm workspaces
# can resolve both packages from a single lockfile.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci

# Development image used by docker-compose: sources are bind-mounted and tsx
# restarts the API on change.
FROM deps AS dev
COPY tsconfig.base.json ./
COPY server ./server
ENV NODE_ENV=development
EXPOSE 5000
CMD ["npm", "run", "dev", "--workspace", "server"]
