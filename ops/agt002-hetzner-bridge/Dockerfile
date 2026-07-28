# Revisar solamente. No construido ni publicado por este plan.
FROM node:22-slim
WORKDIR /opt/agt002-bridge
COPY agt002-hetzner-bridge-signing.js agt002-hetzner-bridge-nonce-store.js agt002-hetzner-bridge-log.js agt002-hetzner-bridge-auth.js agt002-hetzner-bridge-server.js agt002-preview-codex-client.js ./
COPY ops/agt002-hetzner-bridge/run-server.mjs ./ops/agt002-hetzner-bridge/run-server.mjs
USER node
ENTRYPOINT ["node", "ops/agt002-hetzner-bridge/run-server.mjs"]
