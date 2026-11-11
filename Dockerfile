# syntax=docker/dockerfile:1
#
# Nexthlon, built for a hosting platform (Render, Railway, Fly.io, a cloud server...).
#   docker build -t nexthlon .
#   docker run --rm -p 3000:3000 --env-file .env -e MONGODB_URI=<your database> nexthlon
#
# Two stages: the first installs the production packages, the second is the small image that runs.
# The image holds no secrets: every setting comes from environment variables (see .env.example).

# ---------- 1. Production packages ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# "ci" installs exactly what package-lock.json says; --omit=dev leaves out nodemon.
RUN npm ci --omit=dev && npm cache clean --force

# ---------- 2. The image that runs ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Admin photo uploads are written here until they move to cloud storage. A container's disk is wiped
# on every deploy, so mount a volume at /app/public/uploads or the photos disappear.
RUN mkdir -p public/uploads && chown -R node:node public/uploads

# Not root: a bug in the app can't write to the rest of the image.
USER node
EXPOSE 3000

# The platform (or `docker ps`) asks /healthz whether the process is alive. It never touches the
# database, so a database outage doesn't make a healthy app get restarted. /readyz is for load balancers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# server.js handles SIGTERM itself (stops taking visitors, finishes requests, closes the database),
# so node runs directly as the main process.
CMD ["node", "server.js"]
