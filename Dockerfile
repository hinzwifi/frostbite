# Stage 1: Build static PWA bundle
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Empty VITE_POCKETBASE_URL defaults to same-origin (/api proxied by nginx to pocketbase:8090)
ARG VITE_POCKETBASE_URL=""
ENV VITE_POCKETBASE_URL=${VITE_POCKETBASE_URL}
RUN npm run build

# Stage 2: Serve static PWA + reverse-proxy PocketBase via Nginx
FROM nginx:1.27-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
