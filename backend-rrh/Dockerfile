FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Ensure schema.sql is copied to the dist folder after build
RUN mkdir -p dist/db && cp -r src/db/*.sql dist/db/ 2>/dev/null || true

EXPOSE 5007

CMD ["npm", "start"]
