FROM node:22.22.1-alpine
WORKDIR /app
COPY server.mjs openapi.json ./
EXPOSE 8080
CMD ["node", "server.mjs"]
