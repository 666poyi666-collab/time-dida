FROM node:20-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.mobile.config.ts postcss.config.js tailwind.config.js ./
COPY mobile ./mobile
COPY src ./src
COPY shared ./shared
RUN npm run build:web

FROM nginx:1.27-alpine
COPY cloud/nginx-web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist-mobile /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
