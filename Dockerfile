FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

WORKDIR /app/server
RUN npm install
RUN node seed.js

ENV PORT=4000
ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "server.js"]
