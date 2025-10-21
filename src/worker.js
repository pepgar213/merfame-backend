// src/worker.js
import { songQueue } from './workers/songProcessor.js';
import { verificationQueue } from './workers/verificationProcessor.js';

console.log('[Worker Process] Iniciando worker independiente...');
console.log('[Worker Process] Colas disponibles: song-processing, artist-verification');

// ==========================================
// COLA DE PROCESAMIENTO DE CANCIONES
// ==========================================
songQueue.on('completed', (job, result) => {
  console.log(`[Song Queue] Job ${job.id} completado`);
});

songQueue.on('failed', (job, err) => {
  console.error(`[Song Queue] Job ${job.id} falló:`, err.message);
});

songQueue.on('error', (error) => {
  console.error('[Song Queue] Error en la cola:', error);
});

// ==========================================
// COLA DE VERIFICACIÓN DE ARTISTAS
// ==========================================
verificationQueue.on('completed', (job, result) => {
  console.log(`[Verification Queue] Job ${job.id} completado`);
});

verificationQueue.on('failed', (job, err) => {
  console.error(`[Verification Queue] Job ${job.id} falló:`, err.message);
});

verificationQueue.on('error', (error) => {
  console.error('[Verification Queue] Error en la cola:', error);
});

// ==========================================
// MANEJO DE SEÑALES
// ==========================================
process.on('SIGTERM', async () => {
  console.log('[Worker Process] Recibida señal SIGTERM, cerrando...');
  await Promise.all([
    songQueue.close(),
    verificationQueue.close()
  ]);
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Worker Process] Recibida señal SIGINT, cerrando...');
  await Promise.all([
    songQueue.close(),
    verificationQueue.close()
  ]);
  process.exit(0);
});

console.log('[Worker Process] ✅ Worker listo y esperando trabajos...');