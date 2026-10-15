FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && chown -R node:node .next
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["npm","start"]
