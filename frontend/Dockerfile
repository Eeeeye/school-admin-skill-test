FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate \
  && pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN npm run build

FROM caddy:2-alpine

COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

ENV PORT=80
ENV BACKEND_UPSTREAM=localhost:5007
EXPOSE 80
