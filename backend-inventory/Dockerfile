FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Ensure schema.sql and migrations are copied to the dist folder after build
RUN mkdir -p dist/db/migrations && cp src/db/*.sql dist/db/ && (cp -r src/db/migrations/* dist/db/migrations/ 2>/dev/null || true)

EXPOSE 5001

CMD ["npm", "start"]
