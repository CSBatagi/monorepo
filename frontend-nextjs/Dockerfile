# Use the official Node.js runtime as a parent image
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY package*.json ./
# Install all dependencies (including devDependencies) for the build
RUN npm ci
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED=1

# CSbatagi account 
# ENV NEXT_PUBLIC_FIREBASE_API_KEY="AIzaSyBMqX5XVJzgJMByknFGoj713O_WP1643Ks"
# ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="csbatagi-frontend.firebaseapp.com"
# ENV NEXT_PUBLIC_FIREBASE_DATABASE_URL="https://csbatagi-frontend-default-rtdb.europe-west1.firebasedatabase.app"
# ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID="csbatagi-frontend"
# ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="csbatagi-frontend.firebasestorage.app"
# ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="701187279151"
# ENV NEXT_PUBLIC_FIREBASE_APP_ID="1:701187279151:web:680c964e822077c14639da"
# Onur Atak accoung 
ENV NEXT_PUBLIC_FIREBASE_API_KEY="AIzaSyAJpmATHX2Zugnm4c1WhU5Kg9iMOruiZBU"
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="csbatagirealtimedb.firebaseapp.com"
ENV NEXT_PUBLIC_FIREBASE_DATABASE_URL="https://csbatagirealtimedb-default-rtdb.europe-west1.firebasedatabase.app"
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID="csbatagirealtimedb"
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="csbatagirealtimedb.firebasestorage.app"
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="408840223663"
ENV NEXT_PUBLIC_FIREBASE_APP_ID="1:408840223663:web:bdcf576d64b3a1fb6c4d5a"

RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
# set hostname to localhost
ENV HOSTNAME="0.0.0.0"

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD ["node", "server.js"]
