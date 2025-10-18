// src/db/index.js
import sqlite3 from 'sqlite3';

const DB_PATH = process.env.DATABASE_PATH || './database.db';

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error abriendo la base de datos:', err.message);
    } else {
        console.log(`Conectado a la base de datos SQLite en: ${DB_PATH}`);
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`, (createErr) => {
            if (createErr) {
                console.error('Error creando la tabla de usuarios:', createErr.message);
            } else {
                console.log('Tabla de usuarios asegurada.');
            }
        });
    }
});

// Exporta la instancia de la base de datos para que otros módulos puedan usarla.
export default db;