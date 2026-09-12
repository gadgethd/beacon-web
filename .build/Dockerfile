# node:24-alpine
FROM node@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_API_BASE=__VITE_API_BASE__
ENV VITE_WS_URL=__VITE_WS_URL__
ENV VITE_MAP_CENTER=__VITE_MAP_CENTER__
ENV VITE_MAP_ZOOM=__VITE_MAP_ZOOM__
ENV VITE_DISABLED_TABS=__VITE_DISABLED_TABS__
ENV VITE_ENABLED_THEMES=__VITE_ENABLED_THEMES__
ENV VITE_APP_NAME=__VITE_APP_NAME__
ENV VITE_SKIP_SPLASH=__VITE_SKIP_SPLASH__
RUN npm run build

# caddy:2-alpine
FROM caddy@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
COPY .build/Caddyfile /etc/caddy/Caddyfile
COPY .build/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY --from=build /app/dist /srv
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
