// src/db/migrations/add_verification_table.js
import db, { usePostgres } from '../connection.js';

console.log('🔄 Iniciando migración: añadir tabla de verificación de artistas');

const migratePostgres = async () => {
  try {
    console.log('📊 Migrando PostgreSQL...');
    
    // Crear tabla
    await db.query(`
      CREATE TABLE IF NOT EXISTS artist_verification_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(50) UNIQUE NOT NULL,
        platform VARCHAR(20) NOT NULL CHECK (platform IN ('spotify', 'youtube')),
        platform_url TEXT,
        platform_data TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'expired')),
        failure_reason TEXT,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_at TIMESTAMP
      );
    `);
    
    console.log('  ✓ Tabla artist_verification_codes creada');
    
    // Crear índices
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_codes_user_id ON artist_verification_codes(user_id);
      CREATE INDEX IF NOT EXISTS idx_verification_codes_code ON artist_verification_codes(code);
      CREATE INDEX IF NOT EXISTS idx_verification_codes_status ON artist_verification_codes(status);
    `);
    
    console.log('  ✓ Índices creados');
    console.log('✅ Migración PostgreSQL completada');
    
  } catch (error) {
    console.error('❌ Error en migración PostgreSQL:', error.message);
    throw error;
  }
};

const migrateSQLite = () => {
  return new Promise((resolve, reject) => {
    console.log('📊 Migrando SQLite...');
    
    db.run(`
      CREATE TABLE IF NOT EXISTS artist_verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        code TEXT UNIQUE NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('spotify', 'youtube')),
        platform_url TEXT,
        platform_data TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'expired')),
        failure_reason TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        verified_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `, (err) => {
      if (err) {
        console.error('❌ Error creando tabla:', err.message);
        return reject(err);
      }
      
      console.log('  ✓ Tabla artist_verification_codes creada');
      console.log('✅ Migración SQLite completada');
      
      resolve();
    });
  });
};

const runMigration = async () => {
  try {
    if (usePostgres) {
      await migratePostgres();
    } else {
      await migrateSQLite();
    }
    
    console.log('\n🎉 Migración completada exitosamente');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error en migración:', error);
    process.exit(1);
  }
};

runMigration();