FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_AUTH_API_URL=http://localhost:8080
ARG VITE_ML_API_URL=http://localhost:8000
ARG VITE_API_BACKEND=http://localhost:8000
ARG VITE_WEBHOOK_API_URL=http://localhost:3001

ENV VITE_AUTH_API_URL=$VITE_AUTH_API_URL \
    VITE_ML_API_URL=$VITE_ML_API_URL \
    VITE_API_BACKEND=$VITE_API_BACKEND \
    VITE_WEBHOOK_API_URL=$VITE_WEBHOOK_API_URL

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]