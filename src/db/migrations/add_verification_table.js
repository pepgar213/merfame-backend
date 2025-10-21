// src/db/migrations/fix_verification_user_id_nullable.js
import db, { usePostgres } from '../connection.js';

console.log('🔄 Iniciando migración: hacer user_id nullable en verification_codes');

const migratePostgres = async () => {
  try {
    console.log('📊 Migrando PostgreSQL...');
    
    // Hacer user_id nullable
    await db.query(`
      ALTER TABLE artist_verification_codes 
      ALTER COLUMN user_id DROP NOT NULL;
    `);
    
    console.log('  ✓ user_id ahora es nullable');
    
    // Añadir índice para búsquedas sin user_id
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_codes_status_expires 
      ON artist_verification_codes(status, expires_at);
    `);
    
    console.log('  ✓ Índice de optimización creado');
    console.log('✅ Migración PostgreSQL completada');
    
  } catch (error) {
    console.error('❌ Error en migración PostgreSQL:', error.message);
    throw error;
  }
};

const migrateSQLite = () => {
  return new Promise((resolve, reject) => {
    console.log('📊 Migrando SQLite...');
    
    // SQLite no soporta ALTER COLUMN, necesitamos recrear la tabla
    db.serialize(() => {
      // 1. Crear tabla temporal con la nueva estructura
      db.run(`
        CREATE TABLE artist_verification_codes_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
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
        if (err) return reject(err);
        console.log('  ✓ Tabla temporal creada');
      });

      // 2. Copiar datos existentes
      db.run(`
        INSERT INTO artist_verification_codes_new 
        SELECT * FROM artist_verification_codes;
      `, (err) => {
        if (err && !err.message.includes('no such table')) {
          return reject(err);
        }
        console.log('  ✓ Datos copiados');
      });

      // 3. Eliminar tabla antigua
      db.run(`DROP TABLE IF EXISTS artist_verification_codes;`, (err) => {
        if (err) return reject(err);
        console.log('  ✓ Tabla antigua eliminada');
      });

      // 4. Renombrar tabla nueva
      db.run(`
        ALTER TABLE artist_verification_codes_new 
        RENAME TO artist_verification_codes;
      `, (err) => {
        if (err) return reject(err);
        console.log('  ✓ Tabla renombrada');
        console.log('✅ Migración SQLite completada');
        resolve();
      });
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
    console.log('✅ user_id ahora es nullable en artist_verification_codes');
    console.log('📝 Los códigos pueden generarse sin usuario asignado');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error en migración:', error);
    process.exit(1);
  }
};

runMigration();