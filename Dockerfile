# One image for every service; compose picks the entrypoint per service.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
USER node
CMD ["node", "apps/gateway/dist/main.js"]
