FROM node:22-alpine

WORKDIR /app

# Copy dependency definitions and install production packages
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server code, public assets, and seed data
COPY server/ ./server/
COPY public/ ./public/
COPY Pixel_Mission_Sample_Images.xlsx ./

# Cloud Run defaults
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "--experimental-sqlite", "--no-warnings", "server/index.js"]
