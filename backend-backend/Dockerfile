FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Ensure schema.sql is copied to the dist folder after build
RUN mkdir -p dist/db && cp src/db/schema.sql dist/db/

EXPOSE 5006

CMD ["npm", "start"]
