FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY data ./data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
USER node
CMD ["node", "server/index.js"]
