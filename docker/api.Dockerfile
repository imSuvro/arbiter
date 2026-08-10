FROM node:22-bookworm-slim

ENV CI=true
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @arbiter/api... build

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "services/api/dist/index.js"]
