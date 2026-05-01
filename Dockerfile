# syntax=docker/dockerfile:1.7

# ===== Build stage =====
FROM node:20-alpine AS builder

WORKDIR /app

# Cài dependencies trước để tận dụng cache layer
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Build production
COPY . .
RUN npm run build

# ===== Runtime stage =====
FROM caddy:2-alpine

# Caddy serve thư mục /srv
COPY --from=builder /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

# Caddy đã tự expose 80/443
