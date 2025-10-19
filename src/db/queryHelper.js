// src/db/queryHelper.js
import db, { usePostgres } from './connection.js';

/**
 * Convierte placeholders de SQLite (?) a PostgreSQL ($1, $2, $3...)
 */
const convertPlaceholders = (sql) => {
  if (!usePostgres) return sql;
  
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
};

/**
 * Ejecuta una query SELECT que retorna múltiples filas
 * @param {string} sql - Query SQL
 * @param {Array} params - Parámetros de la query
 * @returns {Promise<Array>} Array de resultados
 */
export const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (usePostgres) {
      // PostgreSQL
      const pgSql = convertPlaceholders(sql);
      
      db.query(pgSql, params, (err, result) => {
        if (err) {
          console.error('❌ PostgreSQL Query Error:', err.message);
          console.error('📝 SQL:', pgSql);
          console.error('📊 Params:', params);
          return reject(err);
        }
        resolve(result.rows || []);
      });
    } else {
      // SQLite
      db.all(sql, params, (err, rows) => {
        if (err) {
          console.error('❌ SQLite Query Error:', err.message);
          console.error('📝 SQL:', sql);
          console.error('📊 Params:', params);
          return reject(err);
        }
        resolve(rows || []);
      });
    }
  });
};

/**
 * Ejecuta una query SELECT que retorna UNA sola fila
 * @param {string} sql - Query SQL
 * @param {Array} params - Parámetros de la query
 * @returns {Promise<Object|null>} Objeto con el resultado o null
 */
export const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (usePostgres) {
      // PostgreSQL
      const pgSql = convertPlaceholders(sql);
      
      db.query(pgSql, params, (err, result) => {
        if (err) {
          console.error('❌ PostgreSQL Get Error:', err.message);
          console.error('📝 SQL:', pgSql);
          console.error('📊 Params:', params);
          return reject(err);
        }
        resolve(result.rows[0] || null);
      });
    } else {
      // SQLite
      db.get(sql, params, (err, row) => {
        if (err) {
          console.error('❌ SQLite Get Error:', err.message);
          console.error('📝 SQL:', sql);
          console.error('📊 Params:', params);
          return reject(err);
        }
        resolve(row || null);
      });
    }
  });
};

/**
 * Ejecuta un INSERT/UPDATE/DELETE
 * @param {string} sql - Query SQL
 * @param {Array} params - Parámetros de la query
 * @returns {Promise<Object>} { lastID, changes }
 */
export const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (usePostgres) {
      // PostgreSQL
      let pgSql = convertPlaceholders(sql);
      
      // Si es un INSERT, agregar RETURNING id para obtener el ID generado
      if (pgSql.trim().toUpperCase().startsWith('INSERT') && !pgSql.toUpperCase().includes('RETURNING')) {
        pgSql += ' RETURNING id';
      }
      
      db.query(pgSql, params, (err, result) => {
        if (err) {
          console.error('❌ PostgreSQL Run Error:', err.message);
          console.error('📝 SQL:', pgSql);
          console.error('📊 Params:', params);
          return reject(err);
        }
        
        resolve({
          lastID: result.rows && result.rows[0] ? result.rows[0].id : null,
          changes: result.rowCount || 0
        });
      });
    } else {
      // SQLite
      db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ SQLite Run Error:', err.message);
          console.error('📝 SQL:', sql);
          console.error('📊 Params:', params);
          return reject(err);
        }
        
        resolve({
          lastID: this.lastID,
          changes: this.changes
        });
      });
    }
  });
};

/**
 * Ejecuta múltiples queries en una transacción
 * @param {Function} callback - Función que recibe helpers de query
 * @returns {Promise<any>}
 */
export const transaction = async (callback) => {
  if (usePostgres) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await callback({ query, get, run });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // SQLite - transacciones simples
    return new Promise((resolve, reject) => {
      db.serialize(async () => {
        db.run('BEGIN TRANSACTION');
        try {
          const result = await callback({ query, get, run });
          db.run('COMMIT', (err) => {
            if (err) return reject(err);
            resolve(result);
          });
        } catch (err) {
          db.run('ROLLBACK');
          reject(err);
        }
      });
    });
  }
};