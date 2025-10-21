// src/workers/verificationProcessor.js
import Queue from 'bull';
import { run } from '../db/queryHelper.js';
import { scrapeSpotifyPlaylist, scrapeYoutubeVideo } from '../services/scraperServices.js';

const redisConfig = process.env.REDIS_URL 
  ? process.env.REDIS_URL 
  : {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    };

// Crear la cola de verificación
export const verificationQueue = new Queue('artist-verification', redisConfig, {
  settings: {
    stalledInterval: 30000,
    maxStalledCount: 1,
    lockDuration: 120000,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

// Procesador del worker
export const processVerification = async (job) => {
  const { code, platform, url, verificationId } = job.data;
  
  console.log(`[Verification Worker] Procesando verificación ${verificationId}`);
  console.log(`[Verification Worker] Código: ${code}`);
  console.log(`[Verification Worker] Plataforma: ${platform}`);
  console.log(`[Verification Worker] URL: ${url}`);
  
  try {
    let result;
    
    // Scraping según la plataforma
    if (platform === 'spotify') {
      result = await scrapeSpotifyPlaylist(url, code);
    } else if (platform === 'youtube') {
      result = await scrapeYoutubeVideo(url, code);
    } else {
      throw new Error('Plataforma no soportada');
    }
    
    console.log('[Verification Worker] Resultado:', result);
    
    // Actualizar en base de datos
    await run(
      `UPDATE artist_verification_codes 
      SET status = ?, 
          platform_data = ?,
          failure_reason = ?,
          verified_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        result.verified ? 'verified' : 'failed',
        result.verified ? JSON.stringify({ artistName: result.artistName, platform: result.platform }) : null,
        result.error || null,
        verificationId
      ]
    );
    
    return result;
  } catch (error) {
    console.error('[Verification Worker] ERROR:', error);
    
    // Actualizar en base de datos con error
    await run(
      `UPDATE artist_verifications 
       SET status = 'failed', 
           result_verified = 0,
           result_error = ?,
           completed_at = datetime('now')
       WHERE id = ?`,
      [error.message, verificationId]
    );
    
    throw error;
  }
};

// Registrar el procesador solo si estamos en el proceso worker
const isWorkerProcess = process.argv[1] && (
  process.argv[1].endsWith('worker.js') || 
  process.argv[1].endsWith('src/worker.js') ||
  process.argv[1].includes('src\\worker.js')
);

if (isWorkerProcess) {
  console.log('[Verification Worker] Registrando procesador de verificación de artistas...');
  verificationQueue.process(processVerification);
  
  verificationQueue.on('completed', (job, result) => {
    console.log(`[Verification Worker] Job ${job.id} completado:`, result);
  });

  verificationQueue.on('failed', (job, err) => {
    console.error(`[Verification Worker] Job ${job.id} falló:`, err.message);
  });
  
  console.log('[Verification Worker] ✅ Cola de verificación lista');
}