# Stage 1: Build Frontend
FROM node:20-alpine AS build-stage
WORKDIR /app
COPY SFCS-Unit2-Frontend/package*.json ./
RUN npm install
COPY SFCS-Unit2-Frontend/ ./
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine
# Copy Frontend static files
COPY --from=build-stage /app/dist /usr/share/nginx/html
# Copy Gateway configuration
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
