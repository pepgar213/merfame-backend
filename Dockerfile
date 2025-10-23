# Usar imagen base de Node.js con Debian (mejor compatibilidad con Python/PyTorch)
FROM node:18-slim

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependencias de Python para Silero VAD
RUN pip3 install --no-cache-dir --break-system-packages \
    torch==2.0.1 \
    torchaudio==2.0.2 \
    pydub==0.25.1 \
    numpy==1.24.3

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias de Node.js
COPY package*.json ./

# Instalar dependencias de Node.js
RUN npm install --production

# Copiar el resto del código
COPY . .

# Crear directorios necesarios
RUN mkdir -p /app/temp \
    /app/public/images \
    /app/public/audio \
    /app/public/waveforms \
    /app/public/timestamps

# Exponer puerto
EXPOSE 3000

# Comando de inicio
CMD ["node", "src/index.js"]