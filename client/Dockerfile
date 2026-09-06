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

# Production image. This stage is last on purpose: a builder that is handed this
# Dockerfile with no explicit target builds the final stage, and the final stage
# must never be the development server. Before this existed the `dev` stage was
# last, so a platform build served the app with `vite dev` — unminified, from
# source, with HMR attached and the source maps the deploy build is careful to
# strip. docker-compose pins `target: dev` explicitly and is unaffected.
FROM deps AS build
COPY tsconfig.base.json ./
COPY client ./client
# `build:deploy` rather than `build`: it strips the source maps out of dist/
# after building, so the served output cannot be read back as source.
RUN npm run build:deploy --workspace client

FROM deps AS prod
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/client/vite.config.ts ./client/vite.config.ts
COPY --from=build /app/client/allowedHosts.ts ./client/allowedHosts.ts
COPY tsconfig.base.json ./
ENV NODE_ENV=production
# Inert on Railway, which ignores EXPOSE and injects PORT instead, so this only
# documents a plain `docker run`. It is kept equal to the CMD's fallback below,
# and a test holds the two together, so it cannot come to advertise a port
# nothing listens on.
EXPOSE 4173
# Shell form, not exec form, and that is the whole point: an exec-form CMD is
# handed to execve with no shell in between, so a "$PORT" argument would reach
# Vite as those five literal characters. `sh -c` is what expands it.
#
# `--host` with no value is Vite's `host: true`, which binds the dual-stack
# wildcard (`:::PORT`) and answers on every interface. `--host 0.0.0.0` would be
# narrower rather than safer -- IPv4 only -- and Railway's private network
# resolves to both address families.
#
# This repeats what `vite.config.ts` already computes, deliberately. The port and
# interface a container listens on are its contract with the platform, and that
# contract should not depend on a config file loading correctly.
CMD ["sh", "-c", "npm run preview --workspace client -- --host --port ${PORT:-4173}"]
