# syntax=docker/dockerfile:1.7
FROM node:22.21.1-alpine3.22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run validate

FROM nginx:1.29.3-alpine3.22 AS runtime
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.d/15-runtime-config.envsh /docker-entrypoint.d/15-runtime-config.envsh
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod 0555 /docker-entrypoint.d/15-runtime-config.envsh \
    && chown -R nginx:nginx /usr/share/nginx/html \
    && find /usr/share/nginx/html -type d -exec chmod 0555 {} \; \
    && find /usr/share/nginx/html -type f -exec chmod 0444 {} \;
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
