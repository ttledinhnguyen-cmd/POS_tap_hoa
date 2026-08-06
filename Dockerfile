# syntax=docker/dockerfile:1.7

# ===== Build stage =====
FROM node:20-alpine AS builder

WORKDIR /app

# Cài dependencies trước để tận dụng cache layer
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Vite inline biến VITE_* vào bundle LÚC BUILD. .env.local bị .dockerignore
# loại ra (đúng — không đưa file secret vào image), nên phải truyền qua build
# args, nếu không bundle sẽ thiếu config và app throw ngay khi load.
# Các giá trị này client-safe: anon/publishable key và Goong key đều lộ ra
# browser theo thiết kế (bảo vệ bằng RLS + HTTP referrer restriction).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_GOONG_API_KEY
ARG VITE_SUPPORT_ZALO
ARG VITE_SUPPORT_EMAIL
ARG VITE_BUSINESS_NAME

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_GOONG_API_KEY=$VITE_GOONG_API_KEY \
    VITE_SUPPORT_ZALO=$VITE_SUPPORT_ZALO \
    VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL \
    VITE_BUSINESS_NAME=$VITE_BUSINESS_NAME

# Build production
COPY . .

# Fail sớm với thông báo rõ ràng thay vì build ra bundle trắng màn hình
RUN test -n "$VITE_SUPABASE_URL" -a -n "$VITE_SUPABASE_ANON_KEY" || { \
      echo "LỖI: thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."; \
      echo "Tạo file .env trên server (xem .env.example) rồi build lại."; \
      exit 1; \
    }

RUN npm run build

# ===== Runtime stage =====
FROM caddy:2-alpine

# Caddy serve thư mục /srv
COPY --from=builder /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

# Caddy đã tự expose 80/443
