FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY backend/package*.json ./

RUN npm install

COPY backend/ ./

COPY shared/ /shared/

EXPOSE 5000

CMD ["node", "server.js"]
