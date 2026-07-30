# Production image for the PMAN API (apps/api).
# Build context is the repo root so the workspace lockfile is available.
#
#   docker build -t pman-api .
#   docker run -p 4000:4000 -e JWT_SECRET=... -v pman-data:/data pman-api
FROM node:22-slim

# Prisma's query engine needs OpenSSL; ca-certificates is needed for outbound
# HTTPS (Expo push, Resend email).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Copy only manifests first so dependency layers cache across code changes.
# npm needs every workspace's package.json present to resolve the lockfile.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/

# Install just the API workspace — the mobile app's toolchain is irrelevant
# here and would add gigabytes to the image.
RUN npm ci --omit=dev --workspace @pman/api --include-workspace-root

COPY apps/api apps/api

# Generate the Prisma client for the container's platform (not the host's).
RUN npx --workspace @pman/api prisma generate

# Persistent volume: SQLite database + uploaded files must outlive the
# container, otherwise every deploy wipes real user data.
ENV DATABASE_URL=file:/data/pman.db
ENV UPLOADS_DIR=/data/uploads
RUN mkdir -p /data/uploads
VOLUME /data

ENV PORT=4000
EXPOSE 4000

WORKDIR /app/apps/api
# Applies pending migrations, then boots. Safe to re-run on every deploy.
CMD ["npm", "run", "start:prod"]
