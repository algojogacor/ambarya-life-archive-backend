FROM node:20-slim

RUN apt-get update && apt-get install -y \
  python3 make g++ \
  libvips-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

# Install SEMUA dependencies dulu (termasuk devDeps untuk build)
RUN npm ci

COPY . .

# Build TypeScript
RUN npm run build

# Hapus devDependencies setelah build
RUN npm prune --omit=dev

EXPOSE 3000
CMD ["node", "dist/index.js"]