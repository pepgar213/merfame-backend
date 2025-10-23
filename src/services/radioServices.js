import { query, run, get } from '../db/queryHelper.js';
import { BASE_URL } from '../utils/config.js';

// ==========================================
// HELPER: Manejar URLs completas o relativas
// ==========================================
/**
 * ✅ CORRECCIÓN CRÍTICA: 
 * Las URLs de R2 ya vienen completas de la DB
 * Las URLs locales legacy vienen relativas
 */
const getFullUrl = (url) => {
  if (!url) return null;
  
  // Si ya es una URL completa (R2 o CDN), devolverla tal cual
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Si es relativa (legacy local), concatenar con BASE_URL
  return `${BASE_URL}${url}`;
};

// ==========================================
// GET NEXT SONG
// ==========================================
export const getNextSong = async (artistId = null) => {
  let sql = `
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
    sql += ` WHERE mt.artist_id = ?`;
    params.push(artistId);
  }

  sql += ` ORDER BY RANDOM() LIMIT 1`;

  const row = await get(sql, params);

  if (row) {
    // ✅ CORREGIDO: Usar getFullUrl() en lugar de concatenar siempre
    const song = {
      id: row.id,
      title: row.title,
      audioUrl: getFullUrl(row.audio_url),
      coverImageUrl: getFullUrl(row.cover_image_url),
      duration: row.duration,
      voiceTimestampsUrl: getFullUrl(row.voice_timestamps_url),
      waveformUrl: getFullUrl(row.waveform_url),
      spotifyUrl: row.spotify_id ? `https://open.spotify.com/track/${row.spotify_id}` : null,
      youtubeUrl: row.youtube_id ? `https://www.youtube.com/watch?v=${row.youtube_id}` : null,
      artist: {
        id: row.artist_id,
        name: row.artist_name,
        genre: row.artist_genre,
        imageUrl: getFullUrl(row.artist_image_url),
        bio: row.artist_bio
      }
    };
    
    // Log para debugging
    console.log('[RadioService] Song URLs:', {
      audio: song.audioUrl?.substring(0, 60) + '...',
      cover: song.coverImageUrl?.substring(0, 60) + '...',
      waveform: song.waveformUrl?.substring(0, 60) + '...',
      timestamps: song.voiceTimestampsUrl?.substring(0, 60) + '...'
    });
    
    return song;
  }

  return null;
};

// ==========================================
// LIKE SONG
// ==========================================
export const likeSong = async (userId, songId) => {
  // Eliminar de dislikes si existe
  await run(`DELETE FROM user_dislikes_song WHERE user_id = ? AND song_id = ?`, [userId, songId]);

  // Intentar insertar el like (si ya existe, se ignora)
  try {
    const result = await run(
      `INSERT INTO user_likes_song (user_id, song_id) VALUES (?, ?)`,
      [userId, songId]
    );

    if (result.changes === 0) {
      return { message: 'Ya te gusta esta canción.' };
    }

    return { message: 'Canción marcada como "me gusta" exitosamente.' };
  } catch (error) {
    // Si es un error de constraint (ya existe), no es problema
    if (error.message && error.message.includes('UNIQUE') || error.message.includes('duplicate')) {
      return { message: 'Ya te gusta esta canción.' };
    }
    throw error;
  }
};

// ==========================================
// DISLIKE SONG
// ==========================================
export const dislikeSong = async (userId, songId) => {
  // Eliminar de likes si existe
  await run(`DELETE FROM user_likes_song WHERE user_id = ? AND song_id = ?`, [userId, songId]);

  // Intentar insertar el dislike
  try {
    const result = await run(
      `INSERT INTO user_dislikes_song (user_id, song_id) VALUES (?, ?)`,
      [userId, songId]
    );

    if (result.changes === 0) {
      return { message: 'Ya no te gusta esta canción.' };
    }

    return { message: 'Canción marcada como "no me gusta" exitosamente.' };
  } catch (error) {
    // Si es un error de constraint (ya existe), no es problema
    if (error.message && error.message.includes('UNIQUE') || error.message.includes('duplicate')) {
      return { message: 'Ya no te gusta esta canción.' };
    }
    throw error;
  }
};

// ==========================================
// FOLLOW ARTIST
// ==========================================
export const followArtist = async (userId, artistId) => {
  try {
    const result = await run(
      `INSERT INTO user_follows_artist (user_id, artist_id) VALUES (?, ?)`,
      [userId, artistId]
    );

    if (result.changes === 0) {
      return { message: 'Ya sigues a este artista.' };
    }

    return { message: 'Artista seguido exitosamente.' };
  } catch (error) {
    // Si es un error de constraint (ya existe), no es problema
    if (error.message && error.message.includes('UNIQUE') || error.message.includes('duplicate')) {
      return { message: 'Ya sigues a este artista.' };
    }
    throw error;
  }
};

// ==========================================
// UNFOLLOW ARTIST
// ==========================================
export const unfollowArtist = async (userId, artistId) => {
  const result = await run(
    `DELETE FROM user_follows_artist WHERE user_id = ? AND artist_id = ?`,
    [userId, artistId]
  );

  if (result.changes === 0) {
    return { message: 'No sigues a este artista.' };
  }

  return { message: 'Artista dejado de seguir exitosamente.' };
};