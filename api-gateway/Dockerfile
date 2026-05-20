FROM node:20-alpine
LABEL maintainer="Olade" service="api-gateway"
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY src ./src
EXPOSE 8080
CMD ["node", "src/index.js"]
