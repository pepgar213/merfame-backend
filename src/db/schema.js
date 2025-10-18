// src/db/schema.js
import db from './index.js';

export const createTables = () => {
  db.serialize(() => {
    // 1. Crear la tabla 'users' si no existe
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'listener' NOT NULL,
        is_verified INTEGER DEFAULT 0,
        verification_token TEXT,
        bio TEXT
      );
    `, (err) => {
      if (err) {
        console.error("Error al crear la tabla 'users':", err.message);
      } else {
        console.log("Tabla 'users' verificada/creada.");

        // Verificar y añadir columnas adicionales si no existen
        db.all(`PRAGMA table_info(users);`, (err, rows) => {
          if (err) {
            console.error("Error al verificar la información de la tabla 'users':", err.message);
            return;
          }

          if (!Array.isArray(rows)) {
            console.error("Error: PRAGMA table_info no devolvió un array.", rows);
            return;
          }

          const hasRoleColumn = rows.some(row => row.name === 'role');
          const hasBioColumn = rows.some(row => row.name === 'bio');
          const hasUsernameColumn = rows.some(row => row.name === 'username');
          const hasIsVerifiedColumn = rows.some(row => row.name === 'is_verified');
          const hasVerificationTokenColumn = rows.some(row => row.name === 'verification_token');

          if (!hasRoleColumn) {
            db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'listener' NOT NULL;`, (alterErr) => {
              if (alterErr) {
                console.error("Error al añadir la columna 'role' a la tabla 'users':", alterErr.message);
              } else {
                console.log("Columna 'role' añadida a la tabla 'users'.");
              }
            });
          }

          // Añadir columna bio si no existe
          if (!hasBioColumn) {
            db.run(`ALTER TABLE users ADD COLUMN bio TEXT;`, (alterErr) => {
              if (alterErr) {
                console.error("Error al añadir la columna 'bio' a la tabla 'users':", alterErr.message);
              } else {
                console.log("Columna 'bio' añadida a la tabla 'users'.");
              }
            });
          }

          // Añadir columna username si no existe
          if (!hasUsernameColumn) {
            db.run(`ALTER TABLE users ADD COLUMN username TEXT;`, (alterErr) => {
              if (alterErr) {
                console.error("Error al añadir la columna 'username' a la tabla 'users':", alterErr.message);
              } else {
                console.log("Columna 'username' añadida a la tabla 'users'.");
              }
            });
          }

          // Añadir columna is_verified si no existe
          if (!hasIsVerifiedColumn) {
            db.run(`ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0;`, (alterErr) => {
              if (alterErr) {
                console.error("Error al añadir la columna 'is_verified':", alterErr.message);
              } else {
                console.log("Columna 'is_verified' añadida.");
              }
            });
          }

          // Añadir columna verification_token si no existe
          if (!hasVerificationTokenColumn) {
            db.run(`ALTER TABLE users ADD COLUMN verification_token TEXT;`, (alterErr) => {
              if (alterErr) {
                console.error("Error al añadir la columna 'verification_token':", alterErr.message);
              } else {
                console.log("Columna 'verification_token' añadida.");
              }
            });
          }
        });
      }
    });


    // 2. Crear la tabla 'artists'
    db.run(`
      CREATE TABLE IF NOT EXISTS artists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        name TEXT NOT NULL,
        genre TEXT,
        bio TEXT,
        image_url TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `, (err) => {
      if (err) {
        console.error("Error al crear la tabla 'artists':", err.message);
      } else {
        console.log("Tabla 'artists' verificada/creada.");

        db.all(`PRAGMA table_info(artists);`, (err, rows) => {
          if (err) {
            console.error("Error al verificar la información de la tabla 'artists':", err.message);
            return;
          }
          
          // Añadir columnas de Spotify si no existen
          const spotifyColumns = [
            { name: 'spotify_id', type: 'TEXT' },
            { name: 'spotify_profile_url', type: 'TEXT' },
            { name: 'spotify_display_name', type: 'TEXT' },
            { name: 'spotify_email', type: 'TEXT' },
            { name: 'spotify_country', type: 'TEXT' },
            { name: 'spotify_followers', type: 'INTEGER' },
            { name: 'spotify_images', type: 'TEXT' },
            { name: 'spotify_uri', type: 'TEXT' },
            { name: 'spotify_popularity', type: 'INTEGER' }
          ];

          spotifyColumns.forEach(column => {
            const columnExists = rows.some(row => row.name === column.name);
            if (!columnExists) {
              db.run(`ALTER TABLE artists ADD COLUMN ${column.name} ${column.type};`, (alterErr) => {
                if (alterErr) {
                  console.error(`Error al añadir la columna '${column.name}':`, alterErr.message);
                } else {
                  console.log(`Columna '${column.name}' añadida a la tabla 'artists'.`);
                }
              });
            }
          });
        });
      }
    });

    // 3. Crear la tabla 'music_tracks'
    db.run(`
      CREATE TABLE IF NOT EXISTS music_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        artist_id INTEGER NOT NULL,
        audio_url TEXT NOT NULL,
        cover_image_url TEXT,
        duration INTEGER,
        waveform_url TEXT,
        voice_timestamps_url TEXT,
        spotify_id TEXT,
        youtube_id TEXT,
        FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
      );
    `, (err) => {
      if (err) {
        console.error("Error al crear la tabla 'music_tracks':", err.message);
      } else {
        console.log("Tabla 'music_tracks' verificada/creada.");

        // Verificar y añadir columnas spotify_id y youtube_id si no existen
        db.all(`PRAGMA table_info(music_tracks);`, (err, rows) => {
          if (err) {
            console.error("Error al verificar la información de la tabla 'music_tracks':", err.message);
            return;
          }

          const hasSpotifyIdColumn = rows.some(row => row.name === 'spotify_id');
          const hasYoutubeIdColumn = rows.some(row => row.name === 'youtube_id');

          if (!hasSpotifyIdColumn) {
            db.run(`ALTER TABLE music_tracks ADD COLUMN spotify_id TEXT;`, (alterErr) => {
              if (alterErr) {
                console.error("Error al añadir la columna 'spotify_id' a la tabla 'music_tracks':", alterErr.message);
              } else {
                console.log("Columna 'spotify_id' añadida a la tabla 'music_tracks'.");
              }
            });
          }

          if (!hasYoutubeIdColumn) {
            db.run(`ALTER TABLE music_tracks ADD COLUMN youtube_id TEXT;`, (alterErr) => {
              if (alterErr) {
                console.error("Error al añadir la columna 'youtube_id' a la tabla 'music_tracks':", alterErr.message);
              } else {
                console.log("Columna 'youtube_id' añadida a la tabla 'music_tracks'.");
              }
            });
          }
        });
      }
    });

    // 4. Crear la tabla 'playlists'
    db.run(`
      CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        cover_image_url TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `, (err) => {
      if (err) {
        console.error("Error al crear la tabla 'playlists':", err.message);
      } else {
        console.log("Tabla 'playlists' verificada/creada.");
      }
    });

    // 5. Crear la tabla de unión para 'playlist_tracks'
    db.run(`
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id INTEGER NOT NULL,
        track_id INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, track_id),
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
      );
    `, (err) => {
      if (err) {
        console.error("Error al crear la tabla 'playlist_tracks':", err.message);
      } else {
        console.log("Tabla 'playlist_tracks' verificada/creada.");
      }
    });

    // 6. Crear la tabla 'user_likes_song' para registrar los 'me gusta' de los usuarios a las canciones
    db.run(`
      CREATE TABLE IF NOT EXISTS user_likes_song (
        user_id INTEGER NOT NULL,
        song_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, song_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (song_id) REFERENCES music_tracks(id) ON DELETE CASCADE
      );
    `, (err) => {
      if (err) {
        console.error("Error al crear la tabla 'user_likes_song':", err.message);
      } else {
        console.log("Tabla 'user_likes_song' verificada/creada.");
      }
    });

    // 7. Crear la tabla 'user_follows_artist' para registrar los 'seguimientos' de usuarios a artistas
    db.run(`
      CREATE TABLE IF NOT EXISTS user_follows_artist (
        user_id INTEGER NOT NULL,
        artist_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, artist_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
      );
    `, (err) => {
      if (err) {
        console.error("Error al crear la tabla 'user_follows_artist':", err.message);
      } else {
        console.log("Tabla 'user_follows_artist' verificada/creada.");
      }
    });

    // 8. Crear la tabla 'user_dislikes_song' para registrar los 'no me gusta' de los usuarios a las canciones
    db.run(`
      CREATE TABLE IF NOT EXISTS user_dislikes_song (
        user_id INTEGER NOT NULL,
        song_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, song_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (song_id) REFERENCES music_tracks(id) ON DELETE CASCADE
      );
    `, (err) => {
      if (err) {
        console.error("Error al crear la tabla 'user_dislikes_song':", err.message);
      } else {
        console.log("Tabla 'user_dislikes_song' verificada/creada.");
      }
    });

  });
};