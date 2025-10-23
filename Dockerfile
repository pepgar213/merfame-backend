# Usar imagen base de Node.js con Debian
FROM node:18-slim

# Instalar dependencias del sistema (solo runtime, sin build-essential)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Instalar PyTorch CPU-only (mucho más ligero) y otras dependencias
RUN pip3 install --no-cache-dir --break-system-packages \
    torch==2.0.1+cpu \
    torchaudio==2.0.2+cpu \
    -f https://download.pytorch.org/whl/torch_stable.html \
    && pip3 install --no-cache-dir --break-system-packages \
    pydub==0.25.1 \
    numpy==1.24.3 \
    && rm -rf /root/.cache/pip

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
CMD ["node", "src/startup.js"]