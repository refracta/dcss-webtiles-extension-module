FROM node:24-bookworm-slim

WORKDIR /usr/src

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY config.json ./
COPY src ./src
COPY web ./web

EXPOSE 3000

CMD ["npm", "start"]
