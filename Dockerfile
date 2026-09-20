# Deployment handoff, "Serve the frontend from the API container": the
# Vite build is baked into this image and served by the API's own Express
# instance, same-origin, so the SameSite=Lax session cookie actually
# attaches once this is behind a tunnel — see src/api/server.ts.

FROM node:20-slim AS frontend
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
# Full install (not --omit=dev) here: the build needs typescript, which is a
# devDependency. Pruned back down after the build completes instead.
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev
COPY --from=frontend /app/web/dist ./public
CMD ["npm", "run", "start:api"]
