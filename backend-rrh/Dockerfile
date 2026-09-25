FROM node:22-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

RUN mkdir -p dist/db && cp src/db/schema.sql dist/db/
# Add a non-root user to avoid running as root
# Using the same standard as backend-smt
EXPOSE 5007

# Run the app
CMD ["npm", "start"]
