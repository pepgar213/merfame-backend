// src/worker.js
import { songQueue } from './workers/songProcessor.js';
import { verificationQueue } from './workers/verificationProcessor.js';

console.log('[Worker Process] Iniciando worker independiente...');
console.log('[Worker Process] Colas disponibles: song-processing, artist-verification');

songQueue.on('completed', (job, result) => {
  console.log(`[Worker Process] Job ${job.id} completado`);
});

songQueue.on('failed', (job, err) => {
  console.error(`[Worker Process] Job ${job.id} falló:`, err.message);
});

songQueue.on('error', (error) => {
  console.error('[Worker Process] Error en la cola de canciones:', error);
});

verificationQueue.on('error', (error) => {
  console.error('[Worker Process] Error en la cola de verificación:', error);
});

// Manejar señales para cerrar gracefully
process.on('SIGTERM', async () => {
  console.log('[Worker Process] Recibida señal SIGTERM, cerrando...');
  await songQueue.close();
  await verificationQueue.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Worker Process] Recibida señal SIGINT, cerrando...');
  await songQueue.close();
  await verificationQueue.close();
  process.exit(0);
});

console.log('[Worker Process] ✅ Worker listo y esperando trabajos...');