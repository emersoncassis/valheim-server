FROM node:22-alpine

# docker-cli: o painel liga/para o container do Valheim.
# tar/gzip: backups.
RUN apk add --no-cache docker-cli tar gzip

WORKDIR /app

# Sem dependências de runtime — só stdlib do Node.
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://127.0.0.1:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
