// src/services/storageService.js
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { lookup } from 'mime-types';
import fs from 'fs';
import path from 'path';

const STORAGE_MODE = process.env.STORAGE_MODE || 'local';

// Configuración de R2
const r2Client = STORAGE_MODE === 'r2' ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
}) : null;

const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

/**
 * Genera una ruta estructurada para un archivo de track
 * @param {number} artistId - ID del artista
 * @param {string} trackUniqueId - ID único del track
 * @param {string} fileType - Tipo de archivo: 'audio', 'cover', 'waveform', 'timestamps'
 * @param {string} extension - Extensión del archivo (opcional)
 * @returns {string} Ruta completa del archivo
 */
export const getTrackFilePath = (artistId, trackUniqueId, fileType, extension = null) => {
  const fileNames = {
    audio: 'audio.mp3',
    cover: `cover.${extension || 'jpg'}`,
    waveform: 'waveform.json',
    timestamps: 'timestamps.json'
  };

  return `artists/${artistId}/tracks/${trackUniqueId}/${fileNames[fileType]}`;
};

/**
 * Genera una ruta para la imagen de perfil del artista
 * @param {number} artistId - ID del artista
 * @param {string} extension - Extensión de la imagen
 * @returns {string} Ruta completa del archivo
 */
export const getArtistProfilePath = (artistId, extension = 'jpg') => {
  return `artists/${artistId}/profile/avatar-${Date.now()}.${extension}`;
};

/**
 * Sube un archivo a R2 o almacenamiento local
 * @param {Buffer|Stream} fileData - Datos del archivo o stream
 * @param {string} filePath - Ruta relativa del archivo
 * @param {string} contentType - Tipo MIME del archivo
 * @returns {Promise<string>} URL pública del archivo
 */
export const uploadFile = async (fileData, filePath, contentType = null) => {
  if (STORAGE_MODE === 'r2') {
    return await uploadToR2(fileData, filePath, contentType);
  } else {
    return await uploadToLocal(fileData, filePath);
  }
};

/**
 * Elimina un archivo de R2 o almacenamiento local
 * @param {string} fileUrl - URL completa del archivo o ruta relativa
 * @returns {Promise<void>}
 */
export const deleteFile = async (fileUrl) => {
  if (STORAGE_MODE === 'r2') {
    return await deleteFromR2(fileUrl);
  } else {
    return await deleteFromLocal(fileUrl);
  }
};

/**
 * Elimina todos los archivos de un track (toda la carpeta)
 * @param {number} artistId - ID del artista
 * @param {string} trackUniqueId - ID único del track
 * @returns {Promise<void>}
 */
export const deleteTrackFiles = async (artistId, trackUniqueId) => {
  if (STORAGE_MODE === 'r2') {
    const prefix = `artists/${artistId}/tracks/${trackUniqueId}/`;
    
    try {
      console.log(`[R2] Listando archivos con prefix: ${prefix}`);
      
      const listResponse = await r2Client.send(new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: prefix,
      }));

      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        console.log(`[R2] No se encontraron archivos para eliminar`);
        return;
      }

      console.log(`[R2] Encontrados ${listResponse.Contents.length} archivos para eliminar`);

      // Eliminar todos los archivos
      const deletePromises = listResponse.Contents.map(obj => 
        r2Client.send(new DeleteObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: obj.Key,
        }))
      );

      await Promise.all(deletePromises);
      console.log(`[R2] ✅ Todos los archivos del track eliminados`);
    } catch (error) {
      console.error('[R2] ❌ Error eliminando archivos del track:', error);
      throw error;
    }
  } else {
    // Para local, eliminar archivos individuales
    const files = ['audio', 'cover', 'waveform', 'timestamps'];
    for (const fileType of files) {
      const filePath = getTrackFilePath(artistId, trackUniqueId, fileType);
      await deleteFromLocal(`/${filePath}`).catch(() => {});
    }
  }
};

/**
 * Obtiene la URL pública de un archivo
 * @param {string} filePath - Ruta relativa del archivo
 * @returns {string} URL pública
 */
export const getPublicUrl = (filePath) => {
  if (STORAGE_MODE === 'r2') {
    return `${R2_PUBLIC_URL}/${filePath}`;
  } else {
    return `/${filePath}`;
  }
};

// ==========================================
// FUNCIONES INTERNAS - R2
// ==========================================

const uploadToR2 = async (fileData, filePath, contentType) => {
  try {
    console.log(`[R2] Subiendo archivo: ${filePath}`);
    
    // Auto-detectar content type si no se proporciona
    if (!contentType) {
      contentType = lookup(filePath) || 'application/octet-stream';
    }

    const uploadParams = {
      Bucket: R2_BUCKET_NAME,
      Key: filePath,
      Body: fileData,
      ContentType: contentType,
    };

    // Si fileData es un buffer grande, usar Upload con multipart
    if (Buffer.isBuffer(fileData) && fileData.length > 5 * 1024 * 1024) {
      const upload = new Upload({
        client: r2Client,
        params: uploadParams,
      });

      await upload.done();
    } else {
      // Para archivos pequeños, usar PutObjectCommand
      await r2Client.send(new PutObjectCommand(uploadParams));
    }

    const publicUrl = getPublicUrl(filePath);
    console.log(`[R2] ✅ Archivo subido: ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error('[R2] ❌ Error subiendo archivo:', error);
    throw error;
  }
};

const deleteFromR2 = async (fileUrl) => {
  try {
    // Extraer la key del archivo desde la URL
    let key = fileUrl;
    if (fileUrl.startsWith('http')) {
      key = fileUrl.replace(`${R2_PUBLIC_URL}/`, '');
    }
    
    console.log(`[R2] Eliminando archivo: ${key}`);
    
    await r2Client.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }));
    
    console.log(`[R2] ✅ Archivo eliminado`);
  } catch (error) {
    console.error('[R2] ❌ Error eliminando archivo:', error);
    throw error;
  }
};

// ==========================================
// FUNCIONES INTERNAS - LOCAL
// ==========================================

const uploadToLocal = async (fileData, filePath) => {
  try {
    const fullPath = path.join(process.cwd(), 'public', filePath);
    const dir = path.dirname(fullPath);
    
    // Crear directorio si no existe
    await fs.promises.mkdir(dir, { recursive: true });
    
    // Escribir archivo
    if (Buffer.isBuffer(fileData)) {
      await fs.promises.writeFile(fullPath, fileData);
    } else {
      // Si es un stream, copiarlo
      const writeStream = fs.createWriteStream(fullPath);
      fileData.pipe(writeStream);
      
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    }
    
    console.log(`[Local] ✅ Archivo guardado: ${fullPath}`);
    return `/${filePath}`;
  } catch (error) {
    console.error('[Local] ❌ Error guardando archivo:', error);
    throw error;
  }
};

const deleteFromLocal = async (fileUrl) => {
  try {
    const filePath = path.join(process.cwd(), 'public', fileUrl.replace('/', ''));
    
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      console.log(`[Local] ✅ Archivo eliminado: ${filePath}`);
    }
  } catch (error) {
    console.error('[Local] ❌ Error eliminando archivo:', error);
    throw error;
  }
};

export default {
  uploadFile,
  deleteFile,
  deleteTrackFiles,
  getPublicUrl,
  getTrackFilePath,
  getArtistProfilePath,
  STORAGE_MODE,
};