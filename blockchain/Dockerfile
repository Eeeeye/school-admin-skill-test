FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY hardhat.config.js ./
COPY contracts ./contracts
RUN pnpm compile

FROM node:22-bookworm-slim AS runtime-dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Install into a clean stage: build-only Hardhat, compiler, tests and plugins
# must never be copied into the running private-chain image.
COPY scripts/harden-ganache.cjs ./scripts/
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
    && node scripts/harden-ganache.cjs \
    && node scripts/harden-ganache.cjs --check

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    LOCAL_CHAIN_HOST=0.0.0.0 \
    CHAIN_DATA_DIR=/chain-data \
    DEPLOYMENT_FILE=/deployments/localhost.json \
    CHAIN_READY_FILE=/tmp/registry-ready.json
WORKDIR /app
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=build /app/artifacts/contracts/CertificateRegistry.sol/CertificateRegistry.json ./artifacts/contracts/CertificateRegistry.sol/CertificateRegistry.json
COPY scripts/local-chain.js scripts/chain-healthcheck.js scripts/chain-config.js ./scripts/
RUN mkdir -p /chain-data /deployments && chown node:node /chain-data /deployments
USER node
EXPOSE 8545
HEALTHCHECK --interval=5s --timeout=4s --start-period=30s --retries=6 \
  CMD ["node", "scripts/chain-healthcheck.js"]
CMD ["node", "scripts/local-chain.js"]
