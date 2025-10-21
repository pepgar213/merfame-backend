// src/routes/verificationRoutes.js
import { 
  createVerificationCode, 
  getUserVerificationHistory 
} from '../services/verificationCodeService.js';
import { verificationQueue } from '../workers/verificationProcessor.js';
import { get } from '../db/queryHelper.js';

async function verificationRoutes(fastify, options) {
  
  // ==========================================
  // 1. GENERAR CÓDIGO DE VERIFICACIÓN
  // ==========================================
  fastify.post('/generate-code', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user.id;
    const { platform } = request.body;
    
    console.log(`[Verification API] Generando código para usuario ${userId}, plataforma: ${platform}`);
    
    if (!platform || !['spotify', 'youtube'].includes(platform)) {
      return reply.code(400).send({ 
        message: 'Plataforma inválida. Debe ser "spotify" o "youtube"' 
      });
    }
    
    try {
      const verificationData = await createVerificationCode(userId, platform);
      
      reply.code(201).send({
        success: true,
        ...verificationData
      });
    } catch (error) {
      console.error('[Verification API] Error generando código:', error);
      reply.code(500).send({ 
        message: 'Error generando código de verificación',
        error: error.message 
      });
    }
  });
  
  // ==========================================
  // 2. VERIFICAR CÓDIGO (INICIAR PROCESO)
  // ==========================================
  fastify.post('/verify', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user.id;
    const { code, platform, platformUrl } = request.body;
    
    console.log(`[Verification API] Iniciando verificación para usuario ${userId}`);
    console.log(`[Verification API] Código: ${code}, Plataforma: ${platform}, URL: ${platformUrl}`);
    
    // Validaciones
    if (!code || !platform || !platformUrl) {
      return reply.code(400).send({ 
        message: 'Faltan campos requeridos: code, platform, platformUrl' 
      });
    }
    
    if (!['spotify', 'youtube'].includes(platform)) {
      return reply.code(400).send({ 
        message: 'Plataforma inválida' 
      });
    }
    
    // Validar formato de URL básico
    if (!platformUrl.startsWith('http')) {
      return reply.code(400).send({ 
        message: 'URL inválida' 
      });
    }
    
    try {
      // Obtener el ID del código de verificación
      const verificationCode = await get(
        `SELECT id FROM artist_verification_codes 
         WHERE user_id = ? AND code = ? AND status = 'pending'`,
        [userId, code]
      );
      
      if (!verificationCode) {
        return reply.code(404).send({ 
          message: 'Código de verificación no encontrado o ya usado' 
        });
      }
      
      // Encolar el trabajo de verificación
      const job = await verificationQueue.add({
        userId,
        verificationCodeId: verificationCode.id,
        code,
        platform,
        platformUrl
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10000
        },
        removeOnComplete: 100,
        removeOnFail: 200
      });
      
      console.log(`[Verification API] Job ${job.id} encolado exitosamente`);
      
      reply.code(202).send({
        success: true,
        message: 'Verificación iniciada. Este proceso puede tomar hasta 2 minutos.',
        jobId: job.id,
        status: 'processing'
      });
      
    } catch (error) {
      console.error('[Verification API] Error iniciando verificación:', error);
      reply.code(500).send({ 
        message: 'Error al iniciar el proceso de verificación',
        error: error.message 
      });
    }
  });
  
  // ==========================================
  // 3. CONSULTAR ESTADO DE VERIFICACIÓN
  // ==========================================
  fastify.get('/status/:jobId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { jobId } = request.params;
    const userId = request.user.id;
    
    console.log(`[Verification API] Consultando estado del job ${jobId} para usuario ${userId}`);
    
    try {
      const job = await verificationQueue.getJob(jobId);
      
      if (!job) {
        return reply.code(404).send({ 
          message: 'Job no encontrado' 
        });
      }
      
      // Verificar que el job pertenece al usuario
      if (job.data.userId !== userId) {
        return reply.code(403).send({ 
          message: 'No autorizado para ver este job' 
        });
      }
      
      const state = await job.getState();
      const progress = job.progress();
      const result = job.returnvalue;
      const failedReason = job.failedReason;
      
      reply.code(200).send({
        jobId,
        state,
        progress,
        result: result || null,
        error: failedReason || null,
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: job.finishedOn
      });
      
    } catch (error) {
      console.error('[Verification API] Error consultando estado:', error);
      reply.code(500).send({ 
        message: 'Error al consultar el estado de la verificación',
        error: error.message 
      });
    }
  });
  
  // ==========================================
  // 4. HISTORIAL DE VERIFICACIONES
  // ==========================================
  fastify.get('/history', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const userId = request.user.id;
    
    console.log(`[Verification API] Consultando historial para usuario ${userId}`);
    
    try {
      const history = await getUserVerificationHistory(userId);
      
      reply.code(200).send({
        success: true,
        history
      });
    } catch (error) {
      console.error('[Verification API] Error obteniendo historial:', error);
      reply.code(500).send({ 
        message: 'Error al obtener el historial de verificaciones',
        error: error.message 
      });
    }
  });
  
  // ==========================================
  // 5. CANCELAR VERIFICACIÓN
  // ==========================================
  fastify.delete('/cancel/:jobId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { jobId } = request.params;
    const userId = request.user.id;
    
    console.log(`[Verification API] Cancelando job ${jobId} para usuario ${userId}`);
    
    try {
      const job = await verificationQueue.getJob(jobId);
      
      if (!job) {
        return reply.code(404).send({ 
          message: 'Job no encontrado' 
        });
      }
      
      // Verificar que el job pertenece al usuario
      if (job.data.userId !== userId) {
        return reply.code(403).send({ 
          message: 'No autorizado para cancelar este job' 
        });
      }
      
      const state = await job.getState();
      
      if (state === 'completed' || state === 'failed') {
        return reply.code(400).send({ 
          message: `No se puede cancelar un job en estado ${state}` 
        });
      }
      
      await job.remove();
      
      reply.code(200).send({
        success: true,
        message: 'Verificación cancelada exitosamente'
      });
      
    } catch (error) {
      console.error('[Verification API] Error cancelando verificación:', error);
      reply.code(500).send({ 
        message: 'Error al cancelar la verificación',
        error: error.message 
      });
    }
  });
}

export default verificationRoutes;