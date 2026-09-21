# wasl-api — multi-stage build. Runtime image only carries dist/ + production deps.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r wasl && useradd -r -g wasl wasl && mkdir -p /var/lib/wasl/files && chown wasl:wasl /var/lib/wasl/files
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER wasl
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# migrations run on start so a fresh database is usable immediately; use `node dist/db/migrate.js` alone to migrate without serving
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
