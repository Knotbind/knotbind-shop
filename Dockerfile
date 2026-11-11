# One image, two services: the shop API and the MCP server.
FROM node:22.22.1-alpine
WORKDIR /app
COPY package.json tsconfig.json openapi.json ./
COPY src ./src
RUN npm install --no-audit --no-fund
EXPOSE 8080 8081
