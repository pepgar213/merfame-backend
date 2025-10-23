FROM node:18-alpine

# Instalar FFmpeg y Python (necesarios para el worker)
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    && pip3 install --no-cache-dir \
    tensorflow==2.13.0 \
    numpy==1.24.3 \
    webrtcvad==2.0.10

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
RUN npm install --production

# Copiar el código de la aplicación
COPY . .

# Crear directorios necesarios
RUN mkdir -p /app/temp \
    /app/public/images \
    /app/public/audio \
    /app/public/waveforms \
    /app/public/timestamps

# Exponer puerto
EXPOSE 8081

# Comando de inicio
CMD ["npm", "start"]
