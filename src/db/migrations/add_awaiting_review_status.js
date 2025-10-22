// src/db/migrations/add_awaiting_review_status.js
// Migración para añadir el estado 'awaiting_review' a la tabla de verificaciones
// Compatible con Railway.app y PostgreSQL

import pg from 'pg';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

const { Pool } = pg;

const runMigration = async () => {
  console.log('🔄 Iniciando migración: añadir estado awaiting_review\n');
  
  // Obtener DATABASE_URL del entorno
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL no está definida');
    console.log('\n💡 Opciones:');
    console.log('   1. Definir en .env: DATABASE_URL=postgresql://...');
    console.log('   2. Railway: railway run node src/db/migrations/add_awaiting_review_status.js');
    console.log('   3. Pasar variable: DATABASE_URL=postgresql://... node src/db/migrations/add_awaiting_review_status.js\n');
    process.exit(1);
  }
  
  console.log('📡 Conectando a la base de datos...');
  console.log(`   Host: ${new URL(DATABASE_URL).host}`);
  console.log(`   Database: ${new URL(DATABASE_URL).pathname.substring(1)}\n`);
  
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Requerido para Railway
    }
  });

  try {
    // Verificar conexión
    await pool.query('SELECT NOW()');
    console.log('✅ Conexión establecida\n');
    
    // Paso 1: Verificar estado actual
    console.log('📝 1/4 Verificando estado actual de la tabla...');
    const checkTable = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'artist_verification_codes'
      ORDER BY ordinal_position;
    `);
    
    if (checkTable.rows.length === 0) {
      console.error('❌ ERROR: La tabla artist_verification_codes no existe');
      console.log('   Asegúrate de que el schema se haya creado correctamente\n');
      process.exit(1);
    }
    
    console.log('   ✓ Tabla encontrada con', checkTable.rows.length, 'columnas\n');
    
    // Paso 2: Eliminar constraint existente
    console.log('📝 2/4 Actualizando constraint de status...');
    
    try {
      await pool.query(`
        ALTER TABLE artist_verification_codes 
        DROP CONSTRAINT IF EXISTS artist_verification_codes_status_check;
      `);
      console.log('   ✓ Constraint antiguo eliminado\n');
    } catch (error) {
      console.log('   ⚠️  No se pudo eliminar constraint (quizás no existe)');
      console.log('      Continuando...\n');
    }
    
    // Paso 3: Crear nuevo constraint con awaiting_review
    console.log('📝 3/4 Creando nuevo constraint con awaiting_review...');
    await pool.query(`
      ALTER TABLE artist_verification_codes 
      ADD CONSTRAINT artist_verification_codes_status_check 
      CHECK (status IN ('pending', 'awaiting_review', 'verified', 'failed', 'expired'));
    `);
    console.log('   ✓ Nuevo constraint creado exitosamente\n');
    
    // Paso 4: Crear índices para optimización
    console.log('📝 4/4 Creando índices de optimización...');
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_status_platform 
      ON artist_verification_codes(status, platform);
    `);
    console.log('   ✓ Índice status-platform creado');
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_status_expires 
      ON artist_verification_codes(status, expires_at);
    `);
    console.log('   ✓ Índice status-expires creado\n');
    
    // Verificar resultados
    console.log('🔍 Verificando cambios...');
    const verifyConstraint = await pool.query(`
      SELECT 
        constraint_name,
        constraint_type
      FROM information_schema.table_constraints 
      WHERE table_name = 'artist_verification_codes' 
      AND constraint_name = 'artist_verification_codes_status_check';
    `);
    
    const verifyIndexes = await pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'artist_verification_codes'
      AND indexname LIKE 'idx_verification%';
    `);
    
    console.log('\n✅ MIGRACIÓN COMPLETADA EXITOSAMENTE\n');
    console.log('─'.repeat(60));
    console.log('📊 Resumen de cambios:');
    console.log('─'.repeat(60));
    console.log('✓ Constraint actualizado:', verifyConstraint.rows.length > 0 ? 'Sí' : 'Error');
    console.log('✓ Índices creados:', verifyIndexes.rows.length);
    console.log('✓ Estados soportados: pending, awaiting_review, verified, failed, expired');
    console.log('─'.repeat(60));
    console.log('\n📌 Próximos pasos:');
    console.log('   1. Desplegar el código actualizado en Railway');
    console.log('   2. Verificar que el dashboard funcione correctamente');
    console.log('   3. Probar el flujo completo de verificación\n');
    
  } catch (error) {
    console.error('\n❌ ERROR EN MIGRACIÓN:', error.message);
    console.error('\n📋 Detalles del error:');
    console.error('   Código:', error.code);
    console.error('   Detalle:', error.detail || 'N/A');
    console.error('   Hint:', error.hint || 'N/A');
    console.error('\n💡 Soluciones posibles:');
    console.error('   1. Verificar que la tabla existe: SELECT * FROM artist_verification_codes LIMIT 1;');
    console.error('   2. Verificar permisos de la base de datos');
    console.error('   3. Ejecutar desde Railway: railway run node src/db/migrations/add_awaiting_review_status.js\n');
    throw error;
  } finally {
    await pool.end();
    console.log('🔌 Conexión cerrada\n');
    process.exit(0);
  }
};

// Ejecutar migración
runMigration().catch(error => {
  console.error('💥 Migración falló:', error.message);
  process.exit(1);
});