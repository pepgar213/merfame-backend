// src/services/artistServices.js
import { query, run, get } from '../db/queryHelper.js';

// ==========================================
// GET ARTIST BY SPOTIFY ID
// ==========================================
export const getArtistBySpotifyId = async (spotifyId) => {
  try {
    console.log('ArtistService: Buscando artista con Spotify ID:', spotifyId);
    
    const artist = await get(
      `SELECT user_id, spotify_id, spotify_display_name 
       FROM artists 
       WHERE spotify_id = ?`,
      [spotifyId]
    );
    
    if (artist) {
      console.log('ArtistService: Artista encontrado:', artist);
      return artist;
    }
    
    console.log('ArtistService: No se encontró artista con Spotify ID:', spotifyId);
    return null;
  } catch (error) {
    console.error('ArtistService: ERROR buscando artista:', error);
    throw error;
  }
};

// ==========================================
// UPDATE ARTIST SPOTIFY TOKENS
// ==========================================
export const updateArtistSpotifyTokens = async (userId, accessToken, refreshToken) => {
  try {
    console.log('ArtistService: Actualizando tokens para usuario:', userId);
    
    // Nota: Los tokens ya no se guardan en la BD según tu arquitectura actual
    // Este método se mantiene por compatibilidad pero puede ser eliminado
    
    console.log('ArtistService: Tokens se manejan en SharedPreferences del cliente');
  } catch (error) {
    console.error('ArtistService: ERROR actualizando tokens:', error);
    throw error;
  }
};