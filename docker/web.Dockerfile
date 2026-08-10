FROM node:22-bookworm-slim

ENV CI=true
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @arbiter/web... build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@arbiter/web", "start"]
