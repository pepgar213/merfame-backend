// src/services/scraperServices.js
import fetch from 'node-fetch';

/**
 * Scraping de playlist de Spotify
 */
export const scrapeSpotifyPlaylist = async (url, expectedCode) => {
  try {
    console.log('[Scraper] Verificando playlist de Spotify:', url);
    console.log('[Scraper] Código esperado:', expectedCode);
    
    // Extraer playlist ID de la URL
    const playlistIdMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
    if (!playlistIdMatch) {
      throw new Error('URL de playlist inválida');
    }
    
    const playlistId = playlistIdMatch[1];
    
    // Obtener información de la playlist usando la API de Spotify
    // Nota: Para producción, deberías usar la API oficial con autenticación
    const response = await fetch(`https://open.spotify.com/playlist/${playlistId}`);
    const html = await response.text();
    
    // Buscar el código en el nombre de la playlist
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (!titleMatch) {
      throw new Error('No se pudo obtener el título de la playlist');
    }
    
    const playlistTitle = titleMatch[1];
    console.log('[Scraper] Título de la playlist:', playlistTitle);
    
    // Verificar si el código está en el título
    const codeFound = playlistTitle.includes(expectedCode);
    
    if (!codeFound) {
      return {
        verified: false,
        error: `El código "${expectedCode}" no se encontró en el nombre de la playlist`
      };
    }
    
    // Extraer nombre del artista (usualmente aparece en "Playlist • Artist Name")
    const artistMatch = playlistTitle.match(/•\s*([^•]+?)(?:\s*-\s*Spotify)?$/);
    const artistName = artistMatch ? artistMatch[1].trim() : 'Artista de Spotify';
    
    console.log('[Scraper] ✅ Verificación exitosa');
    
    return {
      verified: true,
      artistName: artistName,
      profileUrl: url,
      platform: 'spotify'
    };
  } catch (error) {
    console.error('[Scraper] Error en Spotify:', error);
    return {
      verified: false,
      error: `Error verificando Spotify: ${error.message}`
    };
  }
};

/**
 * Scraping de video de YouTube
 */
export const scrapeYoutubeVideo = async (url, expectedCode) => {
  try {
    console.log('[Scraper] Verificando video de YouTube:', url);
    console.log('[Scraper] Código esperado:', expectedCode);
    
    // Extraer video ID de la URL
    let videoId;
    if (url.includes('youtube.com/watch?v=')) {
      videoId = url.split('v=')[1]?.split('&')[0];
    } else if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1]?.split('?')[0];
    }
    
    if (!videoId) {
      throw new Error('URL de video inválida');
    }
    
    // Obtener información del video
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await response.text();
    
    // Buscar el código en la descripción del video
    // La descripción está en un JSON dentro del HTML
    const descriptionMatch = html.match(/"description":\{"simpleText":"([^"]+)"/);
    if (!descriptionMatch) {
      throw new Error('No se pudo obtener la descripción del video');
    }
    
    const description = descriptionMatch[1];
    console.log('[Scraper] Descripción encontrada:', description.substring(0, 100) + '...');
    
    // Verificar si el código está en la descripción
    const codeFound = description.includes(expectedCode);
    
    if (!codeFound) {
      return {
        verified: false,
        error: `El código "${expectedCode}" no se encontró en la descripción del video`
      };
    }
    
    // Extraer nombre del canal
    const channelMatch = html.match(/"author":"([^"]+)"/);
    const artistName = channelMatch ? channelMatch[1] : 'Artista de YouTube';
    
    console.log('[Scraper] ✅ Verificación exitosa');
    
    return {
      verified: true,
      artistName: artistName,
      profileUrl: url,
      platform: 'youtube'
    };
  } catch (error) {
    console.error('[Scraper] Error en YouTube:', error);
    return {
      verified: false,
      error: `Error verificando YouTube: ${error.message}`
    };
  }
};