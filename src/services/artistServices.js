// src/services/artistServices.js
import db from '../db/index.js';

export const getArtistBySpotifyId = async (spotifyId) => {
  try {
    console.log('ArtistService: Buscando artista con Spotify ID:', spotifyId);
    
    const query = `
      SELECT user_id, spotify_id, spotify_display_name 
      FROM artists 
      WHERE spotify_id = $1
    `;
    
    const result = await db.query(query, [spotifyId]);
    
    if (result.rows.length > 0) {
      console.log('ArtistService: Artista encontrado:', result.rows[0]);
      return result.rows[0];
    }
    
    console.log('ArtistService: No se encontró artista con Spotify ID:', spotifyId);
    return null;
  } catch (error) {
    console.error('ArtistService: ERROR buscando artista:', error);
    throw error;
  }
};

export const updateArtistSpotifyTokens = async (userId, accessToken, refreshToken) => {
  try {
    console.log('ArtistService: Actualizando tokens para usuario:', userId);
    
    const query = `
      UPDATE artists 
      SET spotify_access_token = $1, spotify_refresh_token = $2, updated_at = NOW()
      WHERE user_id = $3
    `;
    
    await db.query(query, [accessToken, refreshToken, userId]);
    console.log('ArtistService: Tokens actualizados exitosamente');
  } catch (error) {
    console.error('ArtistService: ERROR actualizando tokens:', error);
    throw error;
  }
};