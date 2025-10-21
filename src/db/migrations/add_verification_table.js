// src/db/migrations/fix_verification_nullable.js
import pg from 'pg';
const { Pool } = pg;

const runMigration = async () => {
  console.log('🔄 Iniciando migración: hacer user_id y platform nullable en PostgreSQL\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    // 1. Hacer user_id nullable
    console.log('📝 1/3 Haciendo user_id nullable...');
    await pool.query(`
      ALTER TABLE artist_verification_codes 
      ALTER COLUMN user_id DROP NOT NULL;
    `);
    console.log('  ✓ user_id ahora es nullable');
    
    // 2. Hacer platform nullable
    console.log('📝 2/3 Haciendo platform nullable...');
    await pool.query(`
      ALTER TABLE artist_verification_codes 
      ALTER COLUMN platform DROP NOT NULL;
    `);
    console.log('  ✓ platform ahora es nullable');
    
    // 3. Añadir índice para optimización
    console.log('📝 3/3 Creando índice de optimización...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_codes_status_expires 
      ON artist_verification_codes(status, expires_at);
    `);
    console.log('  ✓ Índice creado');
    
    // Verificar cambios
    const result = await pool.query(`
      SELECT 
        column_name, 
        is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'artist_verification_codes' 
      AND column_name IN ('user_id', 'platform')
      ORDER BY column_name;
    `);
    
    console.log('\n✅ Migración completada exitosamente');
    console.log('📊 Estado de las columnas:');
    console.log('─'.repeat(40));
    console.table(result.rows);
    
  } catch (error) {
    console.error('\n❌ Error en migración:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    await pool.end();
    process.exit(0);
  }
};

runMigration();