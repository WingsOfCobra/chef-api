FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:20-alpine AS runner

RUN apk add --no-cache procps coreutils

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 4242

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
