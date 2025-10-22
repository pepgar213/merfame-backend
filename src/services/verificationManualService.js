// src/services/verificationManualService.js
import { customAlphabet } from 'nanoid';
import { run, get, query } from '../db/queryHelper.js';

// Generar códigos legibles (sin caracteres confusos como 0, O, I, l)
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 12);

// Tiempo de expiración en minutos
const CODE_EXPIRY_MINUTES = parseInt(process.env.VERIFICATION_CODE_EXPIRY || '30');

/**
 * Genera un código de verificación único (sin cambios)
 */
export const generateVerificationCode = async () => {
  try {
    const code = `MERFAME-${nanoid()}`;
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    await run(
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
 * NUEVO: Guarda la solicitud de verificación para revisión manual
 * (Reemplaza verifyArtistCode que hacía scraping automático)
 */
export const submitVerificationRequest = async (code, platform, url) => {
  try {
    console.log('ManualVerification: Recibiendo solicitud de verificación:', code);
    
    // Verificar que el código existe y está pendiente
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
    
    // Validar formato de URL
    if (platform === 'spotify' && !url.includes('spotify.com/playlist/')) {
      throw { statusCode: 400, message: 'URL de playlist de Spotify inválida' };
    }
    
    if (platform === 'youtube' && !url.includes('youtube.com/watch') && !url.includes('youtu.be/')) {
      throw { statusCode: 400, message: 'URL de video de YouTube inválida' };
    }
    
    // Actualizar el registro con la información proporcionada
    // Estado cambia a 'awaiting_review' (nuevo estado para revisión manual)
    await run(
      `UPDATE artist_verification_codes 
       SET status = 'awaiting_review',
           platform = ?,
           platform_url = ?
       WHERE id = ?`,
      [platform, url, verification.id]
    );
    
    console.log('ManualVerification: Solicitud guardada para revisión manual');
    
    return {
      message: 'Solicitud de verificación enviada. Un administrador la revisará pronto.',
      code: code,
      status: 'awaiting_review',
      platform: platform,
      url: url
    };
  } catch (error) {
    console.error('ManualVerification: ERROR:', error);
    throw error.statusCode ? error : { statusCode: 500, message: 'Error al procesar solicitud' };
  }
};

/**
 * NUEVO: Obtiene todas las verificaciones pendientes de revisión
 */
export const getPendingVerifications = async () => {
  try {
    const pending = await query(
      `SELECT 
        id,
        code,
        platform,
        platform_url,
        created_at,
        expires_at
       FROM artist_verification_codes 
       WHERE status = 'awaiting_review'
       ORDER BY created_at DESC`
    );
    
    return pending;
  } catch (error) {
    console.error('ManualVerification: ERROR obteniendo pendientes:', error);
    throw { statusCode: 500, message: 'Error al obtener verificaciones pendientes' };
  }
};

/**
 * NUEVO: Aprueba manualmente una verificación
 */
export const approveVerification = async (verificationId, adminNotes = null) => {
  try {
    const verification = await get(
      `SELECT * FROM artist_verification_codes WHERE id = ?`,
      [verificationId]
    );
    
    if (!verification) {
      throw { statusCode: 404, message: 'Verificación no encontrada' };
    }
    
    if (verification.status !== 'awaiting_review') {
      throw { statusCode: 400, message: 'Esta verificación ya fue procesada' };
    }
    
    // Actualizar a verificado
    await run(
      `UPDATE artist_verification_codes 
       SET status = 'verified',
           verified_at = CURRENT_TIMESTAMP,
           failure_reason = ?
       WHERE id = ?`,
      [adminNotes, verificationId]
    );
    
    console.log(`✅ Verificación ${verificationId} aprobada manualmente`);
    
    return {
      message: 'Verificación aprobada exitosamente',
      verificationId: verificationId,
      code: verification.code
    };
  } catch (error) {
    console.error('ManualVerification: ERROR aprobando:', error);
    throw error.statusCode ? error : { statusCode: 500, message: 'Error al aprobar verificación' };
  }
};

/**
 * NUEVO: Rechaza manualmente una verificación
 */
export const rejectVerification = async (verificationId, reason) => {
  try {
    if (!reason || reason.trim() === '') {
      throw { statusCode: 400, message: 'Debe proporcionar un motivo de rechazo' };
    }
    
    const verification = await get(
      `SELECT * FROM artist_verification_codes WHERE id = ?`,
      [verificationId]
    );
    
    if (!verification) {
      throw { statusCode: 404, message: 'Verificación no encontrada' };
    }
    
    if (verification.status !== 'awaiting_review') {
      throw { statusCode: 400, message: 'Esta verificación ya fue procesada' };
    }
    
    // Actualizar a rechazado
    await run(
      `UPDATE artist_verification_codes 
       SET status = 'failed',
           failure_reason = ?,
           verified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason, verificationId]
    );
    
    console.log(`❌ Verificación ${verificationId} rechazada manualmente`);
    
    return {
      message: 'Verificación rechazada',
      verificationId: verificationId,
      code: verification.code,
      reason: reason
    };
  } catch (error) {
    console.error('ManualVerification: ERROR rechazando:', error);
    throw error.statusCode ? error : { statusCode: 500, message: 'Error al rechazar verificación' };
  }
};

/**
 * Consulta el estado de una verificación (mantener para compatibilidad)
 */
export const getVerificationStatus = async (code) => {
  try {
    const verification = await get(
      `SELECT * FROM artist_verification_codes WHERE code = ?`,
      [code]
    );
    
    if (!verification) {
      throw { statusCode: 404, message: 'Código no encontrado' };
    }
    
    return {
      code: verification.code,
      status: verification.status,
      platform: verification.platform,
      platformUrl: verification.platform_url,
      createdAt: verification.created_at,
      expiresAt: verification.expires_at,
      verifiedAt: verification.verified_at,
      failureReason: verification.failure_reason
    };
  } catch (error) {
    console.error('ManualVerification: ERROR consultando estado:', error);
    throw error.statusCode ? error : { statusCode: 500, message: 'Error al consultar estado' };
  }
};

/**
 * NUEVO: Obtiene todas las verificaciones (para dashboard completo)
 */
export const getAllVerifications = async (status = null, limit = 50) => {
  try {
    let sql = `
      SELECT 
        id,
        code,
        platform,
        platform_url,
        status,
        created_at,
        expires_at,
        verified_at,
        failure_reason
      FROM artist_verification_codes
    `;
    
    const params = [];
    
    if (status) {
      sql += ` WHERE status = ?`;
      params.push(status);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    
    const verifications = await query(sql, params);
    
    return verifications;
  } catch (error) {
    console.error('ManualVerification: ERROR obteniendo todas:', error);
    throw { statusCode: 500, message: 'Error al obtener verificaciones' };
  }
};