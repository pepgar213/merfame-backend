// insertData.js
import readline from 'readline';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ruta relativa fija de la base de datos - AJUSTA ESTA RUTA SEGÚN TU ESTRUCTURA
const DB_PATH = path.join(__dirname, '..', 'database.db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (question) => {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
};

const connectToDatabase = () => {
  return new Promise((resolve, reject) => {
    console.log(`Conectando a la base de datos: ${DB_PATH}`);
    
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('✅ Conexión exitosa a la base de datos');
        resolve(db);
      }
    });
  });
};

const insertManualData = async () => {
  let db;
  
  try {
    // Conectar a la base de datos usando la ruta fija
    db = await connectToDatabase();

    console.log('\n=== INSERCIÓN MANUAL DE DATOS ===\n');

    // 1. Insertar en la tabla users
    console.log('--- Datos para la tabla USERS ---');
    const userData = {
      email: await askQuestion('Email: '),
      username: await askQuestion('Username: '),
      password: await askQuestion('Password: '),
      role: await askQuestion('Role (default: listener): ') || 'listener',
      is_verified: parseInt(await askQuestion('¿Verificado? (0/1, default: 0): ') || 0),
      verification_token: await askQuestion('Token de verificación (opcional): '),
      bio: await askQuestion('Bio (opcional): ')
    };

    // Hashear la contraseña igual que en authService.js
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    console.log('✅ Contraseña hasheada correctamente');

    const userId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO users (email, username, password, role, is_verified, verification_token, bio) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userData.email,
          userData.username,
          hashedPassword, // Usar la contraseña hasheada
          userData.role,
          userData.is_verified,
          userData.verification_token || null,
          userData.bio || null
        ],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    console.log(`✅ Usuario insertado con ID: ${userId}\n`);

    // 2. Insertar en la tabla artists (solo si el rol es 'artist')
    let artistId = null;
    if (userData.role === 'artist') {
      console.log('--- Datos para la tabla ARTISTS ---');
      const artistData = {
        user_id: userId,
        name: await askQuestion('Nombre del artista: '),
        genre: await askQuestion('Género musical (opcional): '),
        bio: await askQuestion('Bio del artista (opcional): '),
        image_url: await askQuestion('URL de imagen (opcional): ')
      };

      // Campos opcionales de Spotify
      const includeSpotify = await askQuestion('¿Incluir datos de Spotify? (s/n): ');
      let spotifyData = {};
      
      if (includeSpotify.toLowerCase() === 's') {
        spotifyData = {
          spotify_id: await askQuestion('Spotify ID (opcional): '),
          spotify_profile_url: await askQuestion('Spotify Profile URL (opcional): '),
          spotify_display_name: await askQuestion('Spotify Display Name (opcional): '),
          spotify_email: await askQuestion('Spotify Email (opcional): '),
          spotify_country: await askQuestion('Spotify Country (opcional): '),
          spotify_followers: await askQuestion('Spotify Followers (opcional): '),
          spotify_images: await askQuestion('Spotify Images (JSON opcional): '),
          spotify_uri: await askQuestion('Spotify URI (opcional): '),
          spotify_popularity: await askQuestion('Spotify Popularity (opcional): ')
        };
      }

      artistId = await new Promise((resolve, reject) => {
        if (includeSpotify.toLowerCase() === 's') {
          db.run(
            `INSERT INTO artists (user_id, name, genre, bio, image_url, 
             spotify_id, spotify_profile_url, spotify_display_name, spotify_email, 
             spotify_country, spotify_followers, spotify_images, spotify_uri, spotify_popularity) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              artistData.user_id,
              artistData.name,
              artistData.genre || null,
              artistData.bio || null,
              artistData.image_url || null,
              spotifyData.spotify_id || null,
              spotifyData.spotify_profile_url || null,
              spotifyData.spotify_display_name || null,
              spotifyData.spotify_email || null,
              spotifyData.spotify_country || null,
              spotifyData.spotify_followers || null,
              spotifyData.spotify_images || null,
              spotifyData.spotify_uri || null,
              spotifyData.spotify_popularity || null
            ],
            function(err) {
              if (err) reject(err);
              else resolve(this.lastID);
            }
          );
        } else {
          db.run(
            `INSERT INTO artists (user_id, name, genre, bio, image_url) 
             VALUES (?, ?, ?, ?, ?)`,
            [
              artistData.user_id,
              artistData.name,
              artistData.genre || null,
              artistData.bio || null,
              artistData.image_url || null
            ],
            function(err) {
              if (err) reject(err);
              else resolve(this.lastID);
            }
          );
        }
      });

      console.log(`✅ Artista insertado con ID: ${artistId}\n`);
    }

    // 3. Insertar/Actualizar en sqlite_sequence
    console.log('--- Actualizar SQLITE_SEQUENCE ---');
    const updateSeq = await askQuestion('¿Actualizar sqlite_sequence? (s/n): ');
    
    if (updateSeq.toLowerCase() === 's') {
      const tableName = await askQuestion('Nombre de la tabla (users/artists/music_tracks/playlists): ');
      const nextId = parseInt(await askQuestion('Nuevo valor para seq: ')) || 0;

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE sqlite_sequence SET seq = ? WHERE name = ?`,
          [nextId, tableName],
          function(err) {
            if (err) reject(err);
            else {
              if (this.changes === 0) {
                // Si no existe, insertar nuevo registro
                db.run(
                  `INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`,
                  [tableName, nextId],
                  (err) => {
                    if (err) reject(err);
                    else {
                      console.log(`✅ sqlite_sequence insertado para ${tableName}`);
                      resolve();
                    }
                  }
                );
              } else {
                console.log(`✅ sqlite_sequence actualizado para ${tableName}`);
                resolve();
              }
            }
          }
        );
      });
    }

    console.log('\n🎉 ¡Inserción completada exitosamente!');
    console.log(`📊 Resumen:`);
    console.log(`   - Usuario insertado: ID ${userId}`);
    if (artistId) {
      console.log(`   - Artista insertado: ID ${artistId}`);
    }
    
    // Mostrar información importante
    console.log(`\n🔐 Información de acceso:`);
    console.log(`   - Email/Username: ${userData.email} / ${userData.username}`);
    console.log(`   - Contraseña: [la que introdujiste]`);
    console.log(`   - Estado verificación: ${userData.is_verified ? 'VERIFICADO' : 'NO VERIFICADO'}`);
    if (!userData.is_verified && userData.verification_token) {
      console.log(`   - Token de verificación: ${userData.verification_token}`);
    }
    
  } catch (error) {
    console.error('❌ Error durante la inserción:', error);
  } finally {
    rl.close();
    if (db) {
      db.close((err) => {
        if (err) {
          console.error('Error al cerrar la base de datos:', err.message);
        } else {
          console.log('🔒 Conexión a la base de datos cerrada.');
        }
      });
    }
  }
};

// Ejecutar el script
insertManualData();