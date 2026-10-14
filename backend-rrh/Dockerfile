FROM node:22-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build
RUN mkdir -p dist/db/migrations && cp -r src/db/migrations/* dist/db/migrations/

# Ensure uploads directory exists and is owned by non-root user
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 5007

# Run directly with node for instant POSIX signal handling (graceful shutdown)
CMD ["node", "dist/index.js"]
