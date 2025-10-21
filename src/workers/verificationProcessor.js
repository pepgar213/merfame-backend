// src/workers/verificationProcessor.js
import Queue from 'bull';
import { verifyPlatform } from '../services/scraperServices.js';
import { 
  validateCode, 
  markCodeAsVerified, 
  markCodeAsFailed 
} from '../services/verificationCodeService.js';
import { run } from '../db/queryHelper.js';

const redisConfig = process.env.REDIS_URL 
  ? process.env.REDIS_URL 
  : {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    };

// Crear la cola de verificación
export const verificationQueue = new Queue('artist-verification', redisConfig, {
  settings: {
    stalledInterval: 60000, // Verificar cada minuto si hay jobs estancados
    maxStalledCount: 2,      // Permitir 2 reintentos de jobs estancados
    lockDuration: 180000,    // 3 minutos de lock (el scraping puede tardar)
    lockRenewTime: 90000,    // Renovar lock cada 1.5 minutos
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000, // 10 segundos inicial
    },
    removeOnComplete: 100,   // Mantener últimos 100 completados
    removeOnFail: 200,       // Mantener últimos 200 fallidos
    timeout: 120000,         // Timeout de 2 minutos por job
  },
});

/**
 * Procesador principal de verificación
 */
export const processVerification = async (job) => {
  const { userId, verificationCodeId, code, platform, platformUrl } = job.data;
  
  const jobId = job.id;
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[JOB ${jobId}] 🔍 INICIANDO VERIFICACIÓN DE ARTISTA`);
  console.log(`[JOB ${jobId}] Usuario ID: ${userId}`);
  console.log(`[JOB ${jobId}] Código: ${code}`);
  console.log(`[JOB ${jobId}] Plataforma: ${platform}`);
  console.log(`[JOB ${jobId}] URL: ${platformUrl}`);
  console.log(`${'='.repeat(80)}\n`);
  
  try {
    // Progreso: Validando código
    await job.progress(10);
    console.log(`[JOB ${jobId}] 📋 Validando código de verificación...`);
    
    const validation = await validateCode(userId, code);
    if (!validation.valid) {
      console.log(`[JOB ${jobId}] ❌ Código inválido: ${validation.reason}`);
      await markCodeAsFailed(verificationCodeId, validation.reason);
      throw new Error(validation.reason);
    }
    
    // Progreso: Iniciando scraping
    await job.progress(30);
    console.log(`[JOB ${jobId}] 🌐 Iniciando proceso de scraping...`);
    
    // Realizar la verificación mediante scraping
    const verificationResult = await verifyPlatform(platform, platformUrl, code);
    
    // Progreso: Scraping completado
    await job.progress(70);
    
    if (verificationResult.success) {
      console.log(`[JOB ${jobId}] ✅ VERIFICACIÓN EXITOSA`);
      console.log(`[JOB ${jobId}] Datos obtenidos:`, JSON.stringify(verificationResult, null, 2));
      
      // Marcar código como verificado
      await markCodeAsVerified(
        verificationCodeId, 
        platformUrl, 
        verificationResult
      );
      
      // Progreso: Actualizando usuario
      await job.progress(90);
      console.log(`[JOB ${jobId}] 📝 Actualizando rol de usuario a artista...`);
      
      // Actualizar el rol del usuario a artista
      await run(
        `UPDATE users SET role = 'artist' WHERE id = ?`,
        [userId]
      );
      
      // Crear o actualizar el perfil de artista
      const artistExists = await run(
        `SELECT id FROM artists WHERE user_id = ?`,
        [userId]
      );
      
      if (!artistExists) {
        // Obtener username del usuario
        const user = await run(
          `SELECT username FROM users WHERE id = ?`,
          [userId]
        );
        
        await run(
          `INSERT INTO artists (user_id, name) VALUES (?, ?)`,
          [userId, user.username || 'Artista']
        );
        console.log(`[JOB ${jobId}] ✅ Perfil de artista creado`);
      }
      
      // Progreso: Completado
      await job.progress(100);
      
      console.log(`[JOB ${jobId}] 🎉 VERIFICACIÓN COMPLETADA EXITOSAMENTE\n`);
      
      return {
        success: true,
        userId,
        platform,
        verificationData: verificationResult,
        message: 'Artista verificado exitosamente'
      };
      
    } else {
      console.log(`[JOB ${jobId}] ❌ VERIFICACIÓN FALLIDA`);
      console.log(`[JOB ${jobId}] Razón: ${verificationResult.reason}`);
      
      await markCodeAsFailed(verificationCodeId, verificationResult.reason);
      
      throw new Error(verificationResult.reason);
    }
    
  } catch (error) {
    console.error(`[JOB ${jobId}] ❌ ERROR EN VERIFICACIÓN:`, error.message);
    console.error(`[JOB ${jobId}] Stack:`, error.stack);
    
    // Marcar como fallido si aún no se marcó
    try {
      await markCodeAsFailed(
        verificationCodeId, 
        error.message || 'Error desconocido durante la verificación'
      );
    } catch (markError) {
      console.error(`[JOB ${jobId}] Error marcando código como fallido:`, markError);
    }
    
    throw error;
  }
};

// SOLO registrar el procesador si estamos en el proceso worker
const isWorkerProcess = process.argv[1] && (
  process.argv[1].endsWith('worker.js') || 
  process.argv[1].endsWith('src/worker.js') ||
  process.argv[1].includes('src\\worker.js')
);

if (isWorkerProcess) {
  console.log('[Verification Worker] Registrando procesador de verificación de artistas...');
  
  verificationQueue.process(processVerification);
  
  verificationQueue.on('completed', (job, result) => {
    console.log(`[Verification Worker] ✅ Job ${job.id} completado exitosamente`);
    console.log(`[Verification Worker] Resultado:`, result);
  });

  verificationQueue.on('failed', (job, err) => {
    console.error(`[Verification Worker] ❌ Job ${job.id} falló:`, err.message);
  });

  verificationQueue.on('progress', (job, progress) => {
    console.log(`[Verification Worker] 📊 Job ${job.id} progreso: ${progress}%`);
  });

  verificationQueue.on('stalled', (job) => {
    console.warn(`[Verification Worker] ⚠️  Job ${job.id} se ha estancado`);
  });

  verificationQueue.on('error', (error) => {
    console.error('[Verification Queue] ❌ Error en la cola:', error);
  });
  
  console.log('[Verification Worker] ✅ Cola de verificación lista');
}