// src/db/migrations/fix_sequences.js
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const fixSequences = async () => {
  console.log('🔧 Iniciando reparación de secuencias de PostgreSQL\n');
  
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL no está definida');
    process.exit(1);
  }
  
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('📡 Conectando a la base de datos...\n');
    
    // Tablas con columnas SERIAL (auto-incremento)
    const tables = [
      { table: 'users', column: 'id', sequence: 'users_id_seq' },
      { table: 'artists', column: 'id', sequence: 'artists_id_seq' },
      { table: 'music_tracks', column: 'id', sequence: 'music_tracks_id_seq' },
      { table: 'playlists', column: 'id', sequence: 'playlists_id_seq' },
      { table: 'artist_verification_codes', column: 'id', sequence: 'artist_verification_codes_id_seq' }
    ];
    
    console.log('📊 Estado ANTES de la reparación:');
    console.log('─'.repeat(80));
    
    for (const { table, column, sequence } of tables) {
      // Obtener el MAX ID actual
      const maxResult = await pool.query(
        `SELECT COALESCE(MAX(${column}), 0) as max_id FROM ${table}`
      );
      const maxId = maxResult.rows[0].max_id;
      
      // Obtener el valor actual de la secuencia
      const seqResult = await pool.query(
        `SELECT last_value FROM ${sequence}`
      );
      const currentSeq = seqResult.rows[0].last_value;
      
      console.log(`${table}:`);
      console.log(`  MAX ID en tabla: ${maxId}`);
      console.log(`  Secuencia actual: ${currentSeq}`);
      console.log(`  ${maxId > currentSeq ? '⚠️  DESINCRONIZADA' : '✅ Sincronizada'}`);
      console.log('');
    }
    
    console.log('\n🔄 Aplicando correcciones...\n');
    
    for (const { table, column, sequence } of tables) {
      // Setear la secuencia al valor correcto: MAX(id) + 1
      await pool.query(
        `SELECT setval('${sequence}', COALESCE((SELECT MAX(${column}) FROM ${table}), 0) + 1, false)`
      );
      
      console.log(`✅ ${table}: Secuencia actualizada`);
    }
    
    console.log('\n📊 Estado DESPUÉS de la reparación:');
    console.log('─'.repeat(80));
    
    for (const { table, column, sequence } of tables) {
      const maxResult = await pool.query(
        `SELECT COALESCE(MAX(${column}), 0) as max_id FROM ${table}`
      );
      const maxId = maxResult.rows[0].max_id;
      
      const seqResult = await pool.query(
        `SELECT last_value FROM ${sequence}`
      );
      const currentSeq = seqResult.rows[0].last_value;
      
      console.log(`${table}:`);
      console.log(`  MAX ID en tabla: ${maxId}`);
      console.log(`  Próximo ID será: ${currentSeq}`);
      console.log(`  ✅ Sincronizada`);
      console.log('');
    }
    
    console.log('\n✅ REPARACIÓN COMPLETADA EXITOSAMENTE\n');
    console.log('📌 Próximos pasos:');
    console.log('   1. Prueba registrar un nuevo artista');
    console.log('   2. Verifica que no haya más errores de duplicate key');
    console.log('   3. Este script se puede ejecutar periódicamente si es necesario\n');
    
  } catch (error) {
    console.error('\n❌ ERROR EN REPARACIÓN:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    await pool.end();
    console.log('🔌 Conexión cerrada\n');
    process.exit(0);
  }
};

// Ejecutar
fixSequences().catch(error => {
  console.error('💥 Reparación falló:', error.message);
  process.exit(1);
});