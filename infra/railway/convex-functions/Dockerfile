FROM ghcr.io/get-convex/convex-backend:c6f2ffdaaa651fbdb9146a9dc1cd0057de343054 AS convex-tools

FROM node:24.18.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY apps/convex/package.json apps/convex/package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY apps/convex/convex.json apps/convex/tsconfig.json ./
COPY apps/convex/convex ./convex
COPY --from=convex-tools /convex/generate_key /usr/local/bin/convex-generate-key
COPY infra/railway/convex-functions/deploy-functions.sh ./deploy-functions.sh
COPY infra/railway/convex-functions/health.mjs ./health.mjs
RUN chmod 0555 /usr/local/bin/convex-generate-key ./deploy-functions.sh
CMD ["./deploy-functions.sh"]
