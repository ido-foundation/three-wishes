FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY bin ./bin
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/wishes.db TRUST_PROXY=1
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.mjs"]
