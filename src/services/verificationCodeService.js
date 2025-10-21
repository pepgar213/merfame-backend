// src/services/verificationCodeService.js
import { customAlphabet } from 'nanoid';
import { run, get, query } from '../db/queryHelper.js';
import { verificationQueue } from '../workers/verificationProcessor.js';

// Generar códigos legibles (sin caracteres confusos como 0, O, I, l)
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 12);

// Tiempo de expiración en minutos
const CODE_EXPIRY_MINUTES = parseInt(process.env.VERIFICATION_CODE_EXPIRY || '30');

/**
 * Genera un código de verificación único (PARA REGISTRO PÚBLICO)
 */
export const generateVerificationCode = async () => {
  try {
    const code = `MERFAME-${nanoid()}`;
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    // Guardar en base de datos
    const result = await run(
      `INSERT INTO artist_verification_codes 
       (code, expires_at, status) 
       VALUES (?, ?, 'pending')`,
      [code, expiresAt.toISOString()]
    );

    console.log(`✅ Código de verificación creado: ${code}`);

    return {
      code,
      expiresAt: expiresAt.toISOString(),
      message: 'Código generado exitosamente'
    };
  } catch (error) {
    console.error('Error generando código:', error);
    throw { statusCode: 500, message: 'Error al generar código de verificación' };
  }
};

/**
 * Verifica el código y encola el trabajo de scraping
 */
export const verifyArtistCode = async (code, platform, url) => {
  try {
    console.log('VerificationService: Verificando código:', code);
    
    // Verificar que el código existe y no ha expirado
    const verification = await get(
      `SELECT * FROM artist_verification_codes 
       WHERE code = ? AND status = 'pending'`,
      [code]
    );
    
    if (!verification) {
      throw { statusCode: 400, message: 'Código inválido o ya usado' };
    }
    
    // Verificar expiración
    const now = new Date();
    const expiresAt = new Date(verification.expires_at);
    if (now > expiresAt) {
      await run(
        `UPDATE artist_verification_codes SET status = 'expired' WHERE id = ?`,
        [verification.id]
      );
      throw { statusCode: 400, message: 'Código expirado' };
    }
    
    // Validar plataforma
    if (!['spotify', 'youtube'].includes(platform)) {
      throw { statusCode: 400, message: 'Plataforma no válida' };
    }
    
    // Encolar trabajo de verificación
    const job = await verificationQueue.add({
      code,
      platform,
      url,
      verificationId: verification.id
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      },
      removeOnComplete: 100,
      removeOnFail: 50
    });
    
    console.log('VerificationService: Job encolado con ID:', job.id);
    
    // Actualizar estado a "processing"
    await run(
      `UPDATE artist_verification_codes 
       SET status = 'processing', platform = ?, platform_url = ?
       WHERE id = ?`,
      [platform, url, verification.id]
    );
    
    return {
      message: 'Verificación iniciada',
      jobId: job.id.toString(),
      status: 'processing'
    };
  } catch (error) {
    console.error('VerificationService: ERROR:', error);
    throw error.statusCode ? error : { statusCode: 500, message: 'Error al iniciar verificación' };
  }
};

/**
 * Obtiene el estado de una verificación
 */
export const getVerificationStatus = async (jobId) => {
  try {
    console.log('VerificationService: Consultando estado del job:', jobId);
    
    // Intentar obtener el job de Bull
    let jobStatus = 'pending';
    let verification = null;
    
    try {
      const job = await verificationQueue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        
        // Mapear estados de Bull a nuestros estados
        if (state === 'completed') jobStatus = 'completed';
        else if (state === 'failed') jobStatus = 'failed';
        else if (state === 'active') jobStatus = 'processing';
        else if (state === 'waiting' || state === 'delayed') jobStatus = 'pending';
        
        // Obtener datos de verificación desde el job
        const { code } = job.data;
        verification = await get(
          `SELECT * FROM artist_verification_codes WHERE code = ?`,
          [code]
        );
      }
    } catch (bullError) {
      console.log('VerificationService: Job no encontrado en Bull');
      throw { statusCode: 404, message: 'Verificación no encontrada' };
    }
    
    if (!verification) {
      throw { statusCode: 404, message: 'Verificación no encontrada' };
    }
    
    const response = {
      jobId,
      status: jobStatus,
      platform: verification.platform,
      result: null
    };
    
    // Si está completado o falló, incluir resultado
    if (jobStatus === 'completed' || jobStatus === 'failed') {
      response.result = {
        verified: verification.status === 'verified',
        artistName: verification.platform_data ? JSON.parse(verification.platform_data).artistName : null,
        profileUrl: verification.platform_url,
        error: verification.failure_reason
      };
    }
    
    console.log('VerificationService: Estado:', response);
    
    return response;
  } catch (error) {
    console.error('VerificationService: ERROR consultando estado:', error);
    throw error.statusCode ? error : { statusCode: 500, message: 'Error al consultar estado' };
  }
};

/**
 * Marca un código como verificado exitosamente
 */
export const markCodeAsVerified = async (codeId, platformUrl, platformData) => {
  try {
    await run(
      `UPDATE artist_verification_codes 
       SET status = 'verified', 
           platform_url = ?,
           platform_data = ?,
           verified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [platformUrl, JSON.stringify(platformData), codeId]
    );

    console.log(`✅ Código ${codeId} marcado como verificado`);
  } catch (error) {
    console.error('Error marcando código como verificado:', error);
    throw error;
  }
};

/**
 * Marca un código como fallido
 */
export const markCodeAsFailed = async (codeId, failureReason) => {
  try {
    await run(
      `UPDATE artist_verification_codes 
       SET status = 'failed',
           failure_reason = ?,
           verified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [failureReason, codeId]
    );

    console.log(`❌ Código ${codeId} marcado como fallido: ${failureReason}`);
  } catch (error) {
    console.error('Error marcando código como fallido:', error);
    throw error;
  }
};