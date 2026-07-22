FROM node:20-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.cloud.config.ts ./
COPY cloud ./cloud
COPY shared ./shared
RUN npm run build:cloud

FROM node:20-alpine
ENV NODE_ENV=production \
    FOCUSLINK_CLOUD_MODE=production \
    PORT=8787 \
    FOCUSLINK_CLOUD_STORE=/data/focuslink-cloud.json
WORKDIR /app
COPY --from=build /build/dist-cloud/server.mjs ./server.mjs
RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
