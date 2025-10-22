// src/db/migrations/add_verification_code_to_artists.js
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const runMigration = async () => {
  console.log('🔄 Iniciando migración: agregar verification_code a artists\n');
  
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL no está definida');
    process.exit(1);
  }
  
  console.log('📡 Conectando a la base de datos...');
  console.log(`   Host: ${new URL(DATABASE_URL).host}\n`);
  
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    // Verificar conexión
    await pool.query('SELECT NOW()');
    console.log('✅ Conexión establecida\n');
    
    // Verificar si la columna ya existe
    console.log('📝 Verificando si la columna ya existe...');
    const checkColumn = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'artists' 
      AND column_name = 'verification_code';
    `);
    
    if (checkColumn.rows.length > 0) {
      console.log('⚠️  La columna verification_code ya existe');
      console.log('✅ No es necesario realizar la migración\n');
      process.exit(0);
    }
    
    console.log('📝 La columna no existe, agregándola...\n');
    
    // Agregar la columna
    await pool.query(`
      ALTER TABLE artists 
      ADD COLUMN verification_code VARCHAR(50) UNIQUE;
    `);
    
    console.log('✅ Columna verification_code agregada exitosamente\n');
    
    // Verificar el resultado
    const verifyColumn = await pool.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'artists' 
      AND column_name = 'verification_code';
    `);
    
    console.log('🔍 Detalles de la columna agregada:');
    console.table(verifyColumn.rows);
    
    console.log('\n✅ MIGRACIÓN COMPLETADA EXITOSAMENTE\n');
    console.log('─'.repeat(60));
    console.log('📋 Próximos pasos:');
    console.log('   1. Reiniciar el servidor en Railway');
    console.log('   2. Probar el registro de artista nuevamente');
    console.log('─'.repeat(60));
    
  } catch (error) {
    console.error('\n❌ ERROR EN MIGRACIÓN:', error.message);
    console.error('\n📋 Detalles del error:');
    console.error('   Código:', error.code);
    console.error('   Detalle:', error.detail || 'N/A');
    throw error;
  } finally {
    await pool.end();
    console.log('\n🔌 Conexión cerrada\n');
    process.exit(0);
  }
};

runMigration().catch(error => {
  console.error('💥 Migración falló:', error.message);
  process.exit(1);
});