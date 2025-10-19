// src/db/connection.js
import pg from 'pg';
import sqlite3 from 'sqlite3';

const { Pool } = pg;

// Determinar qué base de datos usar basándose en la presencia de DATABASE_URL
const usePostgres = !!process.env.DATABASE_URL;

let db;

if (usePostgres) {
  // ==========================================
  // POSTGRESQL (Railway / Producción)
  // ==========================================
  console.log('📊 Usando PostgreSQL');
  console.log('🔗 Database URL:', process.env.DATABASE_URL?.substring(0, 30) + '...');
  
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false
    } : false,
    max: 20, // Máximo de conexiones en el pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  // Test de conexión
  db.query('SELECT NOW() as now, version() as version', (err, res) => {
    if (err) {
      console.error('❌ Error conectando a PostgreSQL:', err.message);
      process.exit(1);
    } else {
      console.log('✅ PostgreSQL conectado exitosamente');
      console.log('⏰ Server time:', res.rows[0].now);
      console.log('📦 PostgreSQL version:', res.rows[0].version.split(' ')[0] + ' ' + res.rows[0].version.split(' ')[1]);
    }
  });

  // Manejo de errores del pool
  db.on('error', (err) => {
    console.error('❌ Error inesperado en PostgreSQL:', err);
    process.exit(-1);
  });

  // Flag para identificar el tipo de DB
  db.isPostgres = true;
  db.type = 'postgres';
  
} else {
  // ==========================================
  // SQLITE (Local / Desarrollo)
  // ==========================================
  console.log('📊 Usando SQLite (modo desarrollo)');
  
  const dbPath = process.env.DATABASE_PATH || './database.db';
  console.log('📂 Database path:', dbPath);
  
  db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      console.error('❌ Error abriendo SQLite:', err.message);
      process.exit(1);
    } else {
      console.log('✅ SQLite conectado exitosamente');
    }
  });

  // Flag para identificar el tipo de DB
  db.isPostgres = false;
  db.type = 'sqlite';
}

export default db;
export { usePostgres };