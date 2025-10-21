// src/services/verificationCodeService.js
import { customAlphabet } from 'nanoid';
import { run, get, query } from '../db/queryHelper.js';

// Generar códigos legibles (sin caracteres confusos como 0, O, I, l)
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 12);

// Tiempo de expiración en minutos
const CODE_EXPIRY_MINUTES = parseInt(process.env.VERIFICATION_CODE_EXPIRY || '30');

/**
 * Genera un código de verificación único
 */
export const generateVerificationCode = () => {
  return `MERFAME-${nanoid()}`;
};

/**
 * Crea un nuevo código de verificación para un usuario
 */
export const createVerificationCode = async (userId, platform) => {
  try {
    // Validar plataforma
    if (!['spotify', 'youtube'].includes(platform)) {
      throw new Error('Plataforma inválida. Debe ser "spotify" o "youtube"');
    }

    // Generar código único
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    // Invalidar códigos anteriores del mismo usuario y plataforma
    await run(
      `UPDATE artist_verification_codes 
       SET status = 'expired' 
       WHERE user_id = ? AND platform = ? AND status = 'pending'`,
      [userId, platform]
    );

    // Insertar nuevo código
    const result = await run(
      `INSERT INTO artist_verification_codes 
       (user_id, code, platform, expires_at, status) 
       VALUES (?, ?, ?, ?, 'pending')`,
      [userId, code, platform, expiresAt.toISOString()]
    );

    console.log(`✅ Código de verificación creado: ${code} para usuario ${userId}`);

    return {
      id: result.lastID,
      code,
      platform,
      expiresAt,
      instructions: getInstructions(platform, code)
    };
  } catch (error) {
    console.error('Error creando código de verificación:', error);
    throw error;
  }
};

/**
 * Obtiene instrucciones específicas para cada plataforma
 */
const getInstructions = (platform, code) => {
  if (platform === 'spotify') {
    return {
      step1: 'Abre Spotify y crea una nueva playlist',
      step2: `Nombra la playlist exactamente: "${code}"`,
      step3: 'Añade al menos una canción a la playlist',
      step4: 'Haz la playlist pública',
      step5: 'Copia la URL de la playlist y pégala aquí',
      example: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'
    };
  } else if (platform === 'youtube') {
    return {
      step1: 'Sube un video público en tu canal de YouTube',
      step2: `Añade el código "${code}" en la descripción del video`,
      step3: 'Asegúrate de que el video sea público',
      step4: 'Copia la URL del video y pégala aquí',
      example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    };
  }
};

/**
 * Verifica si un código es válido y está pendiente
 */
export const validateCode = async (userId, code) => {
  try {
    const verification = await get(
      `SELECT * FROM artist_verification_codes 
       WHERE user_id = ? AND code = ? AND status = 'pending'`,
      [userId, code]
    );

    if (!verification) {
      return { valid: false, reason: 'Código no encontrado o ya usado' };
    }

    // Verificar expiración
    const now = new Date();
    const expiresAt = new Date(verification.expires_at);

    if (now > expiresAt) {
      // Marcar como expirado
      await run(
        `UPDATE artist_verification_codes SET status = 'expired' WHERE id = ?`,
        [verification.id]
      );
      return { valid: false, reason: 'Código expirado' };
    }

    return { 
      valid: true, 
      verification: {
        id: verification.id,
        code: verification.code,
        platform: verification.platform,
        expiresAt
      }
    };
  } catch (error) {
    console.error('Error validando código:', error);
    throw error;
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

/**
 * Obtiene el historial de códigos de un usuario
 */
export const getUserVerificationHistory = async (userId) => {
  try {
    const history = await query(
      `SELECT * FROM artist_verification_codes 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [userId]
    );

    return history;
  } catch (error) {
    console.error('Error obteniendo historial de verificación:', error);
    throw error;
  }
};