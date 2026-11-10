FROM node:22.22.1-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
EXPOSE 8081
CMD ["npm", "start"]
