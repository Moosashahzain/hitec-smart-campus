# HITEC Smart Campus — container image (Back4app / any Docker host)
FROM node:24-slim

WORKDIR /app

# Install deps first (better-sqlite3 is optional and unused on Node 24 — skip it)
COPY package.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

# App source (repo is clean: no node_modules, data/, .env or backups committed)
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# migrate + seed (idempotent) + start server; honors $PORT when the host injects one
CMD ["npm", "start"]
