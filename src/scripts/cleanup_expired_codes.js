// src/scripts/cleanup_expired_codes.js
import { run, query } from '../db/queryHelper.js';

/**
 * Script para limpiar códigos expirados
 * Ejecutar con: node src/scripts/cleanup_expired_codes.js
 */

const cleanupExpiredCodes = async () => {
  try {
    console.log('🧹 Iniciando limpieza de códigos expirados...');
    
    // Obtener códigos pendientes expirados
    const expiredCodes = await query(
      `SELECT id, code, user_id, expires_at 
       FROM artist_verification_codes 
       WHERE status = 'pending' 
       AND expires_at < CURRENT_TIMESTAMP`
    );
    
    console.log(`📊 Códigos expirados encontrados: ${expiredCodes.length}`);
    
    if (expiredCodes.length === 0) {
      console.log('✅ No hay códigos para limpiar');
      return;
    }
    
    // Marcar como expirados
    const result = await run(
      `UPDATE artist_verification_codes 
       SET status = 'expired' 
       WHERE status = 'pending' 
       AND expires_at < CURRENT_TIMESTAMP`
    );
    
    console.log(`✅ ${result.changes} códigos marcados como expirados`);
    
    // Mostrar detalles
    expiredCodes.forEach((code, index) => {
      console.log(`  ${index + 1}. Código: ${code.code} - Usuario: ${code.user_id}`);
    });
    
    console.log('\n🎉 Limpieza completada exitosamente');
    
  } catch (error) {
    console.error('❌ Error durante la limpieza:', error);
    throw error;
  } finally {
    process.exit(0);
  }
};

// Ejecutar
cleanupExpiredCodes();