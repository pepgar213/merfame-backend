# VERSIÓN ULTRA-OPTIMIZADA: ~1.2GB
FROM node:18-slim

# Instalar solo lo esencial
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Instalar PyTorch CPU-only con índice específico (más rápido y pequeño)
RUN pip3 install --no-cache-dir --break-system-packages \
    https://download.pytorch.org/whl/cpu/torch-2.0.1%2Bcpu-cp311-cp311-linux_x86_64.whl \
    https://download.pytorch.org/whl/cpu/torchaudio-2.0.2%2Bcpu-cp311-cp311-linux_x86_64.whl \
    pydub==0.25.1 \
    numpy==1.24.3 \
    && rm -rf /root/.cache/pip

WORKDIR /app

COPY package*.json ./
RUN npm install --production && npm cache clean --force

COPY . .

RUN mkdir -p /app/temp \
    /app/public/images \
    /app/public/audio \
    /app/public/waveforms \
    /app/public/timestamps

EXPOSE 3000

CMD ["node", "src/index.js"]