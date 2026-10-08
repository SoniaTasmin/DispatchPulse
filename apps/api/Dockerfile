# --- Base: Prisma's migration engine needs OpenSSL, which the slim image lacks. Both stages
# share it, so the engine Prisma downloads at build time matches the runtime OpenSSL (3.x).
FROM node:24.21.0-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# --- Build: install all dependencies, generate the Prisma client, compile TypeScript.
FROM base AS build
WORKDIR /app
# The schema must be present before `npm ci`: the postinstall script runs `prisma generate`.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Runtime: compiled code and production dependencies only, running as a non-root user.
FROM base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/prisma.config.ts ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
# Migrations run on start-up. Safe here because there is exactly one API replica; with
# several replicas they would race, so migrations would move to a separate one-off step.
# `exec` makes node PID 1, so it receives SIGTERM directly and shuts down gracefully.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main"]
