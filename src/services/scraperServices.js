// src/services/scraperServices.js
import { initBrowser, closeBrowser, SCRAPING_TIMEOUT } from '../utils/playwrightConfig.js';

/**
 * Extrae el ID de playlist de una URL de Spotify
 */
const extractSpotifyPlaylistId = (url) => {
  const regex = /playlist\/([a-zA-Z0-9]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
};

/**
 * Extrae el ID de video de una URL de YouTube
 */
const extractYouTubeVideoId = (url) => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  
  return null;
};

/**
 * Verifica una playlist de Spotify
 */
export const verifySpotifyPlaylist = async (playlistUrl, expectedCode) => {
  let browser = null;
  
  try {
    console.log(`🔍 Verificando playlist de Spotify: ${playlistUrl}`);
    console.log(`📝 Código esperado: ${expectedCode}`);
    
    // Extraer ID de la playlist
    const playlistId = extractSpotifyPlaylistId(playlistUrl);
    if (!playlistId) {
      throw new Error('URL de playlist de Spotify inválida');
    }
    
    // Inicializar navegador
    const { browser: br, context } = await initBrowser();
    browser = br;
    const page = await context.newPage();
    
    // Navegar a la playlist
    await page.goto(playlistUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: SCRAPING_TIMEOUT 
    });
    
    // Esperar un poco para que cargue el contenido
    await page.waitForTimeout(3000);
    
    // Intentar obtener el nombre de la playlist de múltiples formas
    let playlistName = null;
    
    // Método 1: Por el tag h1
    try {
      playlistName = await page.$eval('h1[data-encore-id="text"]', el => el.textContent.trim());
    } catch (e) {
      console.log('Método 1 falló, intentando método 2...');
    }
    
    // Método 2: Por cualquier h1
    if (!playlistName) {
      try {
        playlistName = await page.$eval('h1', el => el.textContent.trim());
      } catch (e) {
        console.log('Método 2 falló, intentando método 3...');
      }
    }
    
    // Método 3: Por el título de la página
    if (!playlistName) {
      try {
        const title = await page.title();
        // El título suele ser "Nombre de la playlist - playlist by Usuario | Spotify"
        playlistName = title.split(' - ')[0].trim();
      } catch (e) {
        console.log('Método 3 falló');
      }
    }
    
    // Método 4: Buscar en todo el DOM
    if (!playlistName) {
      try {
        const content = await page.content();
        // Buscar el código en todo el HTML
        if (content.includes(expectedCode)) {
          playlistName = expectedCode; // Si encontramos el código, asumimos que está
        }
      } catch (e) {
        console.log('Método 4 falló');
      }
    }
    
    console.log(`📋 Nombre de playlist encontrado: "${playlistName}"`);
    
    // Verificar si el nombre coincide exactamente con el código
    const isValid = playlistName && playlistName.trim() === expectedCode;
    
    if (isValid) {
      console.log('✅ Verificación exitosa: el nombre de la playlist coincide');
      
      // Intentar obtener información adicional
      let ownerName = 'Unknown';
      try {
        ownerName = await page.$eval('a[data-testid="playlist-owner-link"]', el => el.textContent.trim());
      } catch (e) {
        console.log('No se pudo obtener el nombre del propietario');
      }
      
      return {
        success: true,
        platform: 'spotify',
        playlistName,
        ownerName,
        playlistId,
        playlistUrl,
        verifiedAt: new Date().toISOString()
      };
    } else {
      console.log(`❌ Verificación fallida: "${playlistName}" no coincide con "${expectedCode}"`);
      return {
        success: false,
        reason: `El nombre de la playlist "${playlistName}" no coincide con el código esperado "${expectedCode}"`,
        playlistName,
        expectedCode
      };
    }
    
  } catch (error) {
    console.error('❌ Error verificando playlist de Spotify:', error.message);
    return {
      success: false,
      reason: `Error al verificar la playlist: ${error.message}`
    };
  } finally {
    await closeBrowser(browser);
  }
};

/**
 * Verifica un video de YouTube
 */
export const verifyYouTubeVideo = async (videoUrl, expectedCode) => {
  let browser = null;
  
  try {
    console.log(`🔍 Verificando video de YouTube: ${videoUrl}`);
    console.log(`📝 Código esperado: ${expectedCode}`);
    
    // Extraer ID del video
    const videoId = extractYouTubeVideoId(videoUrl);
    if (!videoId) {
      throw new Error('URL de video de YouTube inválida');
    }
    
    // Inicializar navegador
    const { browser: br, context } = await initBrowser();
    browser = br;
    const page = await context.newPage();
    
    // Navegar al video
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { 
      waitUntil: 'domcontentloaded',
      timeout: SCRAPING_TIMEOUT 
    });
    
    // Esperar a que cargue
    await page.waitForTimeout(5000);
    
    // Intentar expandir la descripción si está colapsada
    try {
      const expandButton = await page.$('tp-yt-paper-button#expand');
      if (expandButton) {
        await expandButton.click();
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      console.log('No se pudo expandir la descripción, continuando...');
    }
    
    // Obtener la descripción del video
    let description = '';
    
    // Método 1: Selector moderno de YouTube
    try {
      description = await page.$eval(
        'yt-formatted-string#description-text, ytd-text-inline-expander#description-inline-expander',
        el => el.textContent
      );
    } catch (e) {
      console.log('Método 1 falló, intentando método 2...');
    }
    
    // Método 2: Buscar en el contenido de la página
    if (!description) {
      try {
        const content = await page.content();
        // Buscar el código en el HTML
        if (content.includes(expectedCode)) {
          description = expectedCode; // Si encontramos el código, es suficiente
        }
      } catch (e) {
        console.log('Método 2 falló');
      }
    }
    
    console.log(`📋 Descripción obtenida (primeros 200 chars): ${description.substring(0, 200)}...`);
    
    // Verificar si la descripción contiene el código
    const isValid = description.includes(expectedCode);
    
    if (isValid) {
      console.log('✅ Verificación exitosa: el código se encuentra en la descripción');
      
      // Intentar obtener información adicional
      let videoTitle = 'Unknown';
      let channelName = 'Unknown';
      
      try {
        videoTitle = await page.$eval('h1.ytd-video-primary-info-renderer yt-formatted-string', el => el.textContent.trim());
      } catch (e) {
        console.log('No se pudo obtener el título del video');
      }
      
      try {
        channelName = await page.$eval('ytd-channel-name#channel-name a', el => el.textContent.trim());
      } catch (e) {
        console.log('No se pudo obtener el nombre del canal');
      }
      
      return {
        success: true,
        platform: 'youtube',
        videoTitle,
        channelName,
        videoId,
        videoUrl,
        verifiedAt: new Date().toISOString()
      };
    } else {
      console.log(`❌ Verificación fallida: el código "${expectedCode}" no se encuentra en la descripción`);
      return {
        success: false,
        reason: `El código "${expectedCode}" no se encuentra en la descripción del video`,
        expectedCode
      };
    }
    
  } catch (error) {
    console.error('❌ Error verificando video de YouTube:', error.message);
    return {
      success: false,
      reason: `Error al verificar el video: ${error.message}`
    };
  } finally {
    await closeBrowser(browser);
  }
};

/**
 * Función principal para verificar según la plataforma
 */
export const verifyPlatform = async (platform, url, code) => {
  if (platform === 'spotify') {
    return await verifySpotifyPlaylist(url, code);
  } else if (platform === 'youtube') {
    return await verifyYouTubeVideo(url, code);
  } else {
    throw new Error(`Plataforma no soportada: ${platform}`);
  }
};