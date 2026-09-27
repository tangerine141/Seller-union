FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
