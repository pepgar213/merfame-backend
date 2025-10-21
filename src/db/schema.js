// src/db/schema.js
import db, { usePostgres } from './connection.js';

export const createTables = async () => {
  console.log(`\n🏗️  Iniciando creación de tablas (${usePostgres ? 'PostgreSQL' : 'SQLite'})...`);
  
  if (usePostgres) {
    await createTablesPostgres();
  } else {
    await createTablesSQLite();
  }
  
  console.log('✅ Todas las tablas creadas/verificadas correctamente\n');
};

// ==========================================
// POSTGRESQL SCHEMA
// ==========================================
const createTablesPostgres = async () => {
  try {
    // 1. Tabla users
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role VARCHAR(50) DEFAULT 'listener' NOT NULL,
        is_verified BOOLEAN DEFAULT FALSE,
        verification_token TEXT,
        bio TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✓ users');

    // 2. Tabla artists
    await db.query(`
      CREATE TABLE IF NOT EXISTS artists (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        genre VARCHAR(255),
        bio TEXT,
        image_url TEXT,
        spotify_id VARCHAR(255) UNIQUE,
        spotify_profile_url TEXT,
        spotify_display_name VARCHAR(255),
        spotify_email VARCHAR(255),
        spotify_country VARCHAR(10),
        spotify_followers INTEGER,
        spotify_images TEXT,
        spotify_uri VARCHAR(255),
        spotify_popularity INTEGER,
        verification_code VARCHAR(10) UNIQUE,  -- ✅ NUEVO
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('  ✓ artists');

    // 3. Tabla music_tracks
    await db.query(`
      CREATE TABLE IF NOT EXISTS music_tracks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        audio_url TEXT NOT NULL,
        cover_image_url TEXT,
        duration INTEGER,
        waveform_url TEXT,
        voice_timestamps_url TEXT,
        spotify_id VARCHAR(255),
        youtube_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✓ music_tracks');

    // 4. Tabla playlists
    await db.query(`
      CREATE TABLE IF NOT EXISTS playlists (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        cover_image_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✓ playlists');

    // 5. Tabla playlist_tracks
    await db.query(`
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (playlist_id, track_id)
      );
    `);
    console.log('  ✓ playlist_tracks');

    // 6. Tabla user_likes_song
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_likes_song (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        song_id INTEGER NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
        liked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, song_id)
      );
    `);
    console.log('  ✓ user_likes_song');

    // 7. Tabla user_follows_artist
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_follows_artist (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        followed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, artist_id)
      );
    `);
    console.log('  ✓ user_follows_artist');

    // 8. Tabla user_dislikes_song
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_dislikes_song (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        song_id INTEGER NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
        disliked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, song_id)
      );
    `);
    console.log('  ✓ user_dislikes_song');

    // 9. Índices para mejorar performance
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_artists_user_id ON artists(user_id);
      CREATE INDEX IF NOT EXISTS idx_artists_spotify_id ON artists(spotify_id);
      CREATE INDEX IF NOT EXISTS idx_music_tracks_artist_id ON music_tracks(artist_id);
      CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists(user_id);
    `);

    await db.query(`
  CREATE TABLE IF NOT EXISTS artist_verification_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- ✅ NUEVO
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
console.log('  ✓ artist_verification_codes');

    // 10. Índices adicionales para artist_verification_codes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_codes_user_id ON artist_verification_codes(user_id);
      CREATE INDEX IF NOT EXISTS idx_verification_codes_code ON artist_verification_codes(code);
      CREATE INDEX IF NOT EXISTS idx_verification_codes_status ON artist_verification_codes(status);
    `);


    console.log('  ✓ índices de artist_verification_codes');
    console.log('  ✓ índices de performance');

  } catch (error) {
    console.error('❌ Error creando tablas PostgreSQL:', error.message);
    throw error;
  }
};

// ==========================================
// SQLITE SCHEMA (Para desarrollo local)
// ==========================================
const createTablesSQLite = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Tabla users
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
          console.error("❌ Error creando tabla 'users':", err.message);
          return reject(err);
        }
        console.log("  ✓ users");
      });

      // 2. Tabla artists
      db.run(`
      CREATE TABLE IF NOT EXISTS artists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        name TEXT NOT NULL,
        genre TEXT,
        bio TEXT,
        image_url TEXT,
        spotify_id TEXT UNIQUE,
        spotify_profile_url TEXT,
        spotify_display_name TEXT,
        spotify_email TEXT,
        spotify_country TEXT,
        spotify_followers INTEGER,
        spotify_images TEXT,
        spotify_uri TEXT,
        spotify_popularity INTEGER,
        verification_code TEXT UNIQUE,  -- ✅ NUEVO
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

      // 3. Tabla music_tracks
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
          console.error("❌ Error creando tabla 'music_tracks':", err.message);
          return reject(err);
        }
        console.log("  ✓ music_tracks");
      });

      // 4. Tabla playlists
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
          console.error("❌ Error creando tabla 'playlists':", err.message);
          return reject(err);
        }
        console.log("  ✓ playlists");
      });

      // 5. Tabla playlist_tracks
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
          console.error("❌ Error creando tabla 'playlist_tracks':", err.message);
          return reject(err);
        }
        console.log("  ✓ playlist_tracks");
      });

      // 6. Tabla user_likes_song
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
          console.error("❌ Error creando tabla 'user_likes_song':", err.message);
          return reject(err);
        }
        console.log("  ✓ user_likes_song");
      });

      // 7. Tabla user_follows_artist
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
          console.error("❌ Error creando tabla 'user_follows_artist':", err.message);
          return reject(err);
        }
        console.log("  ✓ user_follows_artist");
      });

      // 8. Tabla user_dislikes_song
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
          console.error("❌ Error creando tabla 'user_dislikes_song':", err.message);
          return reject(err);
        }
        console.log("  ✓ user_dislikes_song");
        resolve();
      });
      // 9. Tabla artist_verification_codes
      db.run(`
        CREATE TABLE IF NOT EXISTS artist_verification_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,  -- ✅ SIN NOT NULL
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
          console.error("❌ Error creando tabla 'artist_verification_codes':", err.message);
          return reject(err);
        }
        console.log("  ✓ artist_verification_codes");
        resolve();
      });
    });
  });
};