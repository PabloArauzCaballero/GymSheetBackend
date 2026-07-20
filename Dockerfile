# syntax=docker/dockerfile:1

##
## Build stage — needs dev dependencies to compile TypeScript.
##
FROM node:22-alpine AS builder

WORKDIR /app

# Copied separately so the dependency layer is reused when only sources change.
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN yarn build \
    # A green build does not prove a runnable artifact: including files outside
    # `src/` shifts the inferred root and moves the entrypoint to dist/src/.
    && test -f dist/main.js \
    && test -f dist/database/migrate.js \
    && test -f dist/workers/access-event.worker.js \
    && test -f dist/workers/membership-reminder.worker.js \
    && test -f dist/workers/notification-delivery.worker.js \
    && test ! -d dist/src

##
## Dependency stage — production modules only, resolved from the same lockfile.
##
FROM node:22-alpine AS dependencies

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production \
    && yarn cache clean

##
## Runtime stage — no compiler, no dev dependencies, no source.
##
FROM node:22-alpine AS runtime

# tini reaps zombies and forwards signals. The application registers SIGTERM
# handlers for graceful shutdown; as PID 1 those would not fire reliably.
RUN apk add --no-cache tini curl

ENV NODE_ENV=production \
    PORT=3000 \
    API_PREFIX=api/v1

WORKDIR /app

# `node` (uid 1000) ships with the base image. Files stay root-owned and
# world-readable so the runtime user cannot modify its own code.
COPY --from=dependencies --chown=root:root /app/node_modules ./node_modules
COPY --from=builder --chown=root:root /app/dist ./dist
COPY --chown=root:root package.json ./

USER node

EXPOSE 3000

# Liveness only: readiness depends on PostgreSQL and Redis, and Docker restarts
# an unhealthy container, which must not happen during a dependency outage.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
    CMD curl --silent --fail "http://127.0.0.1:${PORT}/${API_PREFIX}/health/live" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
