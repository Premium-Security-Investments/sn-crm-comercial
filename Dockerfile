# SIIO / CRM en un solo contenedor: server/index.js sirve la API y el frente compilado (dist).
# Pensado para Cloud Run (escucha en $PORT). Vercel sigue usando api/[...path].js, idéntico a server/index.js.
# Ver /root/handoffs/2026-11-20-AGT-000-PLAN-apps-a-google.md (Fase 1).

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack pnpm install --frozen-lockfile
COPY . .
# El frente lee estas dos en tiempo de compilación (vite.config). Son públicas: URL del proyecto y llave anónima.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
# Sin `pnpm prune --prod`: el servidor importa paquetes que están en devDependencies (p. ej. `pg`), igual que en Vercel.
RUN corepack pnpm run build && rm -rf tests fixtures

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
