// src/services/radioServices.js
import db from '../db/index.js';
import { BASE_URL } from '../utils/config.js';

// Para EMULADORES de Android Studio, usa 10.0.2.2
// Para dispositivos fÍsicos en la misma red, usa la IP de tu máquina host.
 //

export const getNextSong = (artistId = null) => {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT
        mt.id,
        mt.title,
        mt.spotify_id,
        mt.youtube_id,
        mt.audio_url,
        mt.cover_image_url,
        mt.duration,
        mt.waveform_url,
        mt.voice_timestamps_url,
        a.id AS artist_id,
        a.name AS artist_name,
        a.genre AS artist_genre,
        a.image_url AS artist_image_url,
        a.bio AS artist_bio
      FROM music_tracks mt
      JOIN artists a ON mt.artist_id = a.id
    `;
    const params = [];

    if (artistId) {
      query += ` WHERE mt.artist_id = ?`;
      params.push(artistId);
    }

    query += ` ORDER BY RANDOM() LIMIT 1;`;

    db.get(query, params, (err, row) => {
      if (err) {
        console.error("Error al obtener la siguiente canción:", err.message);
        return reject({ statusCode: 500, message: 'Error interno del servidor al consultar la base de datos.' });
      }
      if (row) {
        const song = {
          id: row.id,
          title: row.title,
          audioUrl: `${BASE_URL}${row.audio_url}`,
          coverImageUrl: row.cover_image_url ? `${BASE_URL}${row.cover_image_url}` : null,
          duration: row.duration,
          voiceTimestampsUrl: row.voice_timestamps_url ? 
            `${BASE_URL}${row.voice_timestamps_url}` : null,
          waveformUrl: `${BASE_URL}${row.waveform_url}`,
          spotifyId: row.spotify_id || null,
          youtubeId: row.youtube_id || null,
          artist: {
            id: row.artist_id,
            name: row.artist_name,
            genre: row.artist_genre,
            imageUrl: row.artist_image_url,
            bio: row.artist_bio
          }
        };
        resolve(song);
      } else {
        resolve(null);
      }
    });
  });
};

/**
 * Registra que a un usuario le gusta una canción.
 * @param {number} userId - ID del usuario.
 * @param {number} songId - ID de la canción.
 * @returns {Promise<object>} - Promesa que resuelve con un mensaje de éxito o rechaza con un error.
 */
export const likeSong = (userId, songId) => {
  return new Promise((resolve, reject) => {
    // Eliminar de dislikes si existe
    db.run(`DELETE FROM user_dislikes_song WHERE user_id = ? AND song_id = ?`, [userId, songId], (err) => {
      if (err) {
        console.error("Error al eliminar dislike antes de like:", err.message);
        // Continuar de todos modos, el like es la acción principal
      }
    });

    db.run(`
      INSERT OR IGNORE INTO user_likes_song (user_id, song_id)
      VALUES (?, ?);
    `, [userId, songId], function (err) {
      if (err) {
        console.error(`Error al registrar 'me gusta' para la canción ${songId} por el usuario ${userId}:`, err.message);
        return reject({ statusCode: 500, message: 'Error interno del servidor al registrar "me gusta".' });
      }
      if (this.changes === 0) {
        // No se insertó porque ya existía
        resolve({ message: 'Ya te gusta esta canción.' });
      } else {
        resolve({ message: 'Canción marcada como "me gusta" exitosamente.' });
      }
    });
  });
};

/**
 * Registra que a un usuario no le gusta una canción.
 * @param {number} userId - ID del usuario.
 * @param {number} songId - ID de la canción.
 * @returns {Promise<object>} - Promesa que resuelve con un mensaje de éxito o rechaza con un error.
 */
export const dislikeSong = (userId, songId) => {
  return new Promise((resolve, reject) => {
    // Eliminar de likes si existe
    db.run(`DELETE FROM user_likes_song WHERE user_id = ? AND song_id = ?`, [userId, songId], (err) => {
      if (err) {
        console.error("Error al eliminar like antes de dislike:", err.message);
      }
    });

    db.run(`
      INSERT OR IGNORE INTO user_dislikes_song (user_id, song_id)
      VALUES (?, ?);
    `, [userId, songId], function (err) {
      if (err) {
        console.error(`Error al registrar 'no me gusta' para la canción ${songId} por el usuario ${userId}:`, err.message);
        return reject({ statusCode: 500, message: 'Error interno del servidor al registrar "no me gusta".' });
      }
      if (this.changes === 0) {
        // No se insertó porque ya existía
        resolve({ message: 'Ya no te gusta esta canción.' });
      } else {
        resolve({ message: 'Canción marcada como "no me gusta" exitosamente.' });
      }
    });
  });
};

/**
 * Registra que un usuario sigue a un artista.
 * @param {number} userId - ID del usuario.
 * @param {number} artistId - ID del artista.
 * @returns {Promise<object>} - Promesa que resuelve con un mensaje de éxito o rechaza con un error.
 */
export const followArtist = (userId, artistId) => {
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT OR IGNORE INTO user_follows_artist (user_id, artist_id)
      VALUES (?, ?);
    `, [userId, artistId], function (err) {
      if (err) {
        console.error(`Error al seguir al artista ${artistId} por el usuario ${userId}:`, err.message);
        return reject({ statusCode: 500, message: 'Error interno del servidor al registrar el seguimiento.' });
      }
      if (this.changes === 0) {
        // No se insertó porque ya existía
        resolve({ message: 'Ya sigues a este artista.' });
      } else {
        resolve({ message: 'Artista seguido exitosamente.' });
      }
    });
  });
};

/**
 * Elimina el registro de seguimiento de un artista por un usuario.
 * @param {number} userId - ID del usuario.
 * @param {number} artistId - ID del artista.
 * @returns {Promise<object>} - Promesa que resuelve con un mensaje de éxito o rechaza con un error.
 */
export const unfollowArtist = (userId, artistId) => {
  return new Promise((resolve, reject) => {
    db.run(`
      DELETE FROM user_follows_artist
      WHERE user_id = ? AND artist_id = ?;
    `, [userId, artistId], function (err) {
      if (err) {
        console.error(`Error al dejar de seguir al artista ${artistId} por el usuario ${userId}:`, err.message);
        return reject({ statusCode: 500, message: 'Error interno del servidor al dejar de seguir al artista.' });
      }
      if (this.changes === 0) {
        // No se encontró el registro para eliminar
        resolve({ message: 'No sigues a este artista.' });
      } else {
        resolve({ message: 'Artista dejado de seguir exitosamente.' });
      }
    });
  });
};