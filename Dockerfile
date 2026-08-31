# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# GHManager container image.
#
# Multi-stage so the runtime image carries only Next.js standalone output:
# a server.js, the reachable node_modules, and the static assets. No source,
# no dev dependencies, no build cache.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=22-alpine


# --- deps: install dependencies against the lockfile only -------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Copying just the manifests keeps this layer cached until dependencies change.
COPY package.json package-lock.json ./
RUN npm ci


# --- builder: type-check and compile the production build -------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Telemetry would otherwise phone home during the build.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build


# --- runner: minimal runtime image ------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind to every interface; the container's loopback is not reachable from the host.
ENV HOSTNAME=0.0.0.0
# Where the managed token store lives; mount a volume here so tokens added
# through the UI survive container rebuilds.
ENV GHMANAGER_DATA_DIR=/app/data

# Run unprivileged. The node image already ships a `node` user (uid 1000).
# The data directory is created with the right owner so a named volume
# inherits it on first use.
RUN mkdir -p /app/data && chown -R node:node /app

# `standalone` contains server.js plus a pruned node_modules; the static
# directory is served by that server and has to be copied alongside it.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

# Hits a real route handler, so an unhealthy container is one that cannot
# actually answer requests - not merely one whose process is alive.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/auth').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
