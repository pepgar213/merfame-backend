import fetch from 'node-fetch';
import { registerUser, updateArtistWithSpotifyData } from './authServices.js';
import crypto from 'crypto';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Nueva función para generar code verifier y challenge
export const generatePKCECodes = () => {
  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  
  return { codeVerifier, codeChallenge };
};

// Función para forzar renovación de token (útil cuando sabemos que está expirado)
export const forceRefreshSpotifyToken = async (userId) => {
  try {
    console.log('SpotifyService: forceRefreshSpotifyToken - Forzando renovación para usuario:', userId);
    
    const artist = await getArtistByUserId(userId);
    if (!artist || !artist.spotify_refresh_token) {
      throw new Error('No se puede renovar: no hay refresh token disponible');
    }

    const newTokens = await refreshSpotifyToken(artist.spotify_refresh_token);
    
    // Actualizar en base de datos
    await updateArtistSpotifyTokens(userId, newTokens.access_token, newTokens.refresh_token);
    
    console.log('SpotifyService: Token renovado exitosamente');
    return newTokens;
  } catch (error) {
    console.error('SpotifyService: ERROR forzando renovación:', error.message);
    throw error;
  }
};

export const authenticateWithSpotifyPKCE = async (authCode, redirectUri, codeVerifier) => {
  try {
    console.log('SpotifyService: authenticateWithSpotifyPKCE - Iniciando autenticación con PKCE');
    console.log('SpotifyService: authCode:', authCode ? `${authCode.substring(0, 10)}...` : 'NULL');
    console.log('SpotifyService: redirectUri:', redirectUri);
    console.log('SpotifyService: codeVerifier:', codeVerifier ? `${codeVerifier.substring(0, 10)}...` : 'NULL');
    
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        client_id: SPOTIFY_CLIENT_ID,
        code_verifier: codeVerifier
      })
    });

    console.log('SpotifyService: Respuesta de Spotify - Status:', response.status);

    const responseText = await response.text();
    console.log('SpotifyService: Response Body:', responseText);

    if (!response.ok) {
      console.error('SpotifyService: ERROR en autenticación PKCE - Status:', response.status);
      console.error('SpotifyService: Error Body:', responseText);
      throw new Error(`Error de Spotify: ${response.status} - ${responseText}`);
    }

    const data = JSON.parse(responseText);
    console.log('SpotifyService: Autenticación PKCE EXITOSA');
    console.log('SpotifyService: Access Token:', data.access_token ? `${data.access_token.substring(0, 10)}...` : 'NULL');
    console.log('SpotifyService: Refresh Token:', data.refresh_token ? `${data.refresh_token.substring(0, 10)}...` : 'NULL');
    
    return data;
  } catch (error) {
    console.error('SpotifyService: ERROR en autenticación PKCE:', error.message);
    console.error('SpotifyService: Stack:', error.stack);
    throw { statusCode: 500, message: 'Error al autenticar con Spotify: ' + error.message };
  }
};

// Mantener la función original para compatibilidad, pero marcar como obsoleta
export const authenticateWithSpotify = async (authCode, redirectUri) => {
  console.warn('SpotifyService: authenticateWithSpotify está obsoleta, usar authenticateWithSpotifyPKCE');
  return authenticateWithSpotifyPKCE(authCode, redirectUri, '');
};

// Las demás funciones (refreshSpotifyToken, getSpotifyProfile, registerUserWithSpotify) se mantienen igual
export const refreshSpotifyToken = async (refreshToken) => {
  try {
    console.log('SpotifyService: refreshSpotifyToken - Renovando token');
    console.log('SpotifyService: Refresh Token recibido:', refreshToken ? `${refreshToken.substring(0, 15)}...` : 'NULL');
    
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });

    console.log('SpotifyService: Respuesta renovación - Status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SpotifyService: ERROR renovando token - Status:', response.status);
      console.error('SpotifyService: Error Body:', errorText);
      
      if (response.status === 400) {
        throw new Error('REFRESH_TOKEN_INVALID');
      }
      
      throw new Error(`Error al renovar token: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('SpotifyService: Token renovado EXITOSAMENTE');
    console.log('SpotifyService: Nuevo Access Token:', data.access_token ? `${data.access_token.substring(0, 15)}...` : 'NULL');
    console.log('SpotifyService: Nuevo Refresh Token:', data.refresh_token ? `${data.refresh_token.substring(0, 15)}...` : 'NULL');
    
    // ✅ SI NO VIENE NUEVO REFRESH TOKEN, MANTENER EL ACTUAL
    if (!data.refresh_token) {
      console.log('SpotifyService: No se recibió nuevo refresh token, manteniendo el anterior');
      data.refresh_token = refreshToken;
    }
    
    // ✅ LOS TOKENS SE MANEJAN EN SHAREDPREFERENCES, NO EN BD
    console.log('SpotifyService: Tokens renovados - deben guardarse en SharedPreferences del cliente');
    
    return data;
  } catch (error) {
    console.error('SpotifyService: ERROR renovando token:', error.message);
    if (error.message === 'REFRESH_TOKEN_INVALID') {
      throw { statusCode: 401, message: 'Refresh token inválido. Se requiere reautenticación.' };
    }
    throw { statusCode: 500, message: 'Error al renovar token de Spotify: ' + error.message };
  }
};

export const getSpotifyArtist = async (accessToken, artistId) => {
  try {
    console.log('SpotifyService: getSpotifyArtist - Obteniendo detalles del artista:', artistId);
    
    const response = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('SpotifyService: Respuesta detalles artista - Status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SpotifyService: ERROR obteniendo detalles artista - Status:', response.status);
      throw new Error(`Error al obtener artista: ${response.status} - ${errorText}`);
    }

    const artistData = await response.json();
    console.log('SpotifyService: Detalles del artista obtenidos EXITOSAMENTE:', artistData.name);
    console.log('SpotifyService: Popularidad del artista:', artistData.popularity);
    
    return artistData;
  } catch (error) {
    console.error('SpotifyService: ERROR en getSpotifyArtist:', error.message);
    throw error;
  }
};


export const getSpotifyProfile = async (accessToken, retryCount = 0) => {
  try {
    console.log('SpotifyService: getSpotifyProfile - Obteniendo perfil (intento:', retryCount + 1, ')');
    
    console.log('SpotifyService: Intentando obtener perfil con token:', accessToken ? `${accessToken.substring(0, 20)}...` : 'NULL');
    
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('SpotifyService: Respuesta del perfil - Status:', response.status);

    if (response.status === 401) {
      const errorText = await response.text();
      console.log('SpotifyService: Token expirado (401). Error:', errorText);
      throw new Error('TOKEN_EXPIRED');
    }

    if (response.status === 403) {
      const errorText = await response.text();
      console.log('SpotifyService: Acceso denegado (403). Error:', errorText);
      throw new Error('ACCESS_DENIED');
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SpotifyService: ERROR obteniendo perfil - Status:', response.status);
      throw new Error(`HTTP_ERROR_${response.status}`);
    }

    const profileData = await response.json();
    console.log('SpotifyService: Perfil obtenido EXITOSAMENTE:', profileData.display_name);
    
    // ✅ NUEVO: Obtener popularidad si es un artista
    let popularity = null;
    if (profileData.type === 'artist' || profileData.uri?.includes('artist')) {
      try {
        console.log('SpotifyService: Es un artista, obteniendo detalles de popularidad...');
        const artistDetails = await getSpotifyArtist(accessToken, profileData.id);
        popularity = artistDetails.popularity;
        console.log('SpotifyService: Popularidad obtenida:', popularity);
      } catch (artistError) {
        console.error('SpotifyService: Error obteniendo popularidad del artista:', artistError.message);
        // Continuamos sin popularidad si hay error
      }
    }
    
    return {
      profile: profileData,
      popularity: popularity // ✅ Añadimos la popularidad a la respuesta
    };
    
  } catch (error) {
    console.error('SpotifyService: ERROR obteniendo perfil:', error.message);
    
    let errorMessage = 'Error al obtener perfil de Spotify';
    if (error.message === 'TOKEN_EXPIRED') {
      errorMessage = 'Token de acceso expirado. Se requiere renovación.';
    } else if (error.message === 'ACCESS_DENIED') {
      errorMessage = 'Acceso denegado por Spotify.';
    }
    
    throw { statusCode: 401, message: errorMessage };
  }
};


export const registerUserWithSpotify = async (email, password, role, username, spotifyData, spotifyAccessToken, spotifyRefreshToken) => {
  try {
    console.log('SpotifyService: registerUserWithSpotify - Iniciando registro');
    console.log('SpotifyService: Email:', email);
    console.log('SpotifyService: Role:', role);
    console.log('SpotifyService: Username:', username);
    console.log('SpotifyService: Spotify Data:', spotifyData ? 'PRESENTE' : 'AUSENTE');
    console.log('SpotifyService: Access Token:', spotifyAccessToken ? 'PRESENTE' : 'AUSENTE');
    
    // Los tokens se manejan en SharedPreferences, no se envían al backend para guardar en BD
    const userResult = await registerUser(email, password, role, username);
    console.log('SpotifyService: Usuario registrado - ID:', userResult.userId);
    
    if (role === 'artist' && spotifyData) {
      console.log('SpotifyService: Actualizando artista con datos de Spotify (sin tokens)');
      const spotifyInfo = {
        spotify_id: spotifyData.id,
        spotify_profile_url: spotifyData.external_urls?.spotify,
        spotify_display_name: spotifyData.display_name,
        spotify_email: spotifyData.email,
        spotify_country: spotifyData.country,
        spotify_followers: spotifyData.followers?.total,
        spotify_images: spotifyData.images ? JSON.stringify(spotifyData.images) : null,
        spotify_uri: spotifyData.uri
        // NOTA: No incluimos access_token ni refresh_token
      };
      
      await updateArtistWithSpotifyData(userResult.userId, spotifyInfo);
      console.log('SpotifyService: Datos de Spotify guardados EXITOSAMENTE (sin tokens)');
    } else {
      console.log('SpotifyService: No se requieren datos de Spotify para este rol');
    }
    
    console.log('SpotifyService: Registro COMPLETADO exitosamente');
    return userResult;
  } catch (error) {
    console.error('SpotifyService: ERROR en registerUserWithSpotify:', error.message);
    console.error('SpotifyService: Stack:', error.stack);
    throw error;
  }
};