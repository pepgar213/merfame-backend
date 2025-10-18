// src/routes/spotifyRoutes.js
import { 
  authenticateWithSpotifyPKCE,
  generatePKCECodes,
  getSpotifyProfile,
  registerUserWithSpotify,
  refreshSpotifyToken
} from '../services/spotifyServices.js';
import { getArtistBySpotifyId } from '../services/artistServices.js'; // ✅ Añadir esta importación


async function spotifyRoutes(fastify, options) {
  console.log('SpotifyRoutes: Registrando rutas de Spotify');

  // Nueva ruta para generar PKCE codes
  fastify.get('/spotify/pkce', async (request, reply) => {
    console.log('SpotifyRoutes: /spotify/pkce - Generando códigos PKCE');
    try {
      const { codeVerifier, codeChallenge } = generatePKCECodes();
      console.log('SpotifyRoutes: Códigos PKCE generados exitosamente');
      
      reply.code(200).send({
        codeVerifier,
        codeChallenge,
        clientId: process.env.SPOTIFY_CLIENT_ID 
      });
    } catch (error) {
      console.error('SpotifyRoutes: ERROR generando códigos PKCE:', error);
      reply.code(500).send({ message: 'Error generando códigos PKCE' });
    }
  });

  fastify.post('/spotify/auth', async (request, reply) => {
    console.log('SpotifyRoutes: /spotify/auth - Request recibido');
    const { authCode, redirectUri, codeVerifier } = request.body;
    console.log('SpotifyRoutes: authCode:', authCode ? `${authCode.substring(0, 10)}...` : 'NULL');
    console.log('SpotifyRoutes: redirectUri:', redirectUri);
    console.log('SpotifyRoutes: codeVerifier:', codeVerifier ? `${codeVerifier.substring(0, 10)}...` : 'NULL');

    if (!authCode || !redirectUri || !codeVerifier) {
      console.log('SpotifyRoutes: ERROR - Parámetros faltantes para PKCE');
      return reply.code(400).send({ message: 'Código de autorización, redirect URI y code verifier son requeridos para PKCE.' });
    }

    try {
      console.log('SpotifyRoutes: Llamando a authenticateWithSpotifyPKCE');
      const result = await authenticateWithSpotifyPKCE(authCode, redirectUri, codeVerifier);
      console.log('SpotifyRoutes: Autenticación PKCE exitosa');
      reply.code(200).send(result);
    } catch (error) {
      console.error('SpotifyRoutes: ERROR en autenticación PKCE:', error);
      reply.code(error.statusCode || 500).send({ message: error.message || 'Error al autenticar con Spotify.' });
    }
  });

  fastify.get('/spotify/verify-token/:userId', async (request, reply) => {
  console.log('SpotifyRoutes: /spotify/verify-token - Verificando token');
  const { userId } = request.params;
  
  if (!userId) {
    return reply.code(400).send({ message: 'User ID requerido.' });
  }

  try {
    const result = await ensureValidSpotifyToken(userId);
    console.log('SpotifyRoutes: Token verificado/renovado exitosamente');
    
    reply.code(200).send({
      message: 'Token de Spotify válido',
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      profile: result.profile
    });
  } catch (error) {
    console.error('SpotifyRoutes: ERROR verificando token:', error);
    reply.code(error.statusCode || 500).send({ 
      message: error.message || 'Error al verificar token de Spotify.' 
    });
  }
});

  fastify.get('/spotify/profile', async (request, reply) => {
  console.log('SpotifyRoutes: /spotify/profile - Request recibido');
  
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ message: 'Token de acceso requerido en header Authorization' });
  }
  
  const access_token = authHeader.substring(7);
  const { spotify_id } = request.query;
  
  console.log('SpotifyRoutes: Access Token del header');
  console.log('SpotifyRoutes: Spotify ID:', spotify_id || 'NO PROPORCIONADO');
  
  try {
      // ✅ OBTENER USER_ID DESDE SPOTIFY_ID SI ESTÁ DISPONIBLE
      let userId = null;
      if (spotify_id) {
        try {
          const artist = await getArtistBySpotifyId(spotify_id);
          if (artist) {
            userId = artist.user_id;
            console.log('SpotifyRoutes: User ID encontrado:', userId);
          }
        } catch (error) {
          console.log('SpotifyRoutes: No se pudo obtener user_id, continuando sin él');
        }
      }
      
      // ✅ OBTENER PERFIL CON POPULARIDAD
      const result = await getSpotifyProfile(access_token);
      console.log('SpotifyRoutes: Perfil obtenido exitosamente');
      console.log('SpotifyRoutes: Popularidad:', result.popularity);
      
      reply.code(200).send({
          profile: result.profile,
          popularity: result.popularity, // ✅ INCLUIR POPULARIDAD EN RESPUESTA
          access_token: result.access_token,
          refresh_token: result.refresh_token
      });
  } catch (error) {
      console.error('SpotifyRoutes: ERROR obteniendo perfil:', error);
      reply.code(error.statusCode || 500).send({ 
          message: error.message || 'Error al obtener perfil de Spotify.' 
      });
  }
});

  fastify.post('/register-with-spotify', async (request, reply) => {
    console.log('SpotifyRoutes: /register-with-spotify - Request recibido');
    const { email, password, role, username, spotifyData, spotifyAccessToken, spotifyRefreshToken } = request.body;
    console.log('SpotifyRoutes: Email:', email);
    console.log('SpotifyRoutes: Role:', role);
    console.log('SpotifyRoutes: Spotify Data presente:', !!spotifyData);

    if (!email || !password || !role || !username) {
      console.log('SpotifyRoutes: ERROR - Campos requeridos faltantes');
      return reply.code(400).send({ message: 'Email, contraseña, rol y nombre de usuario son requeridos.' });
    }

    if (role === 'artist' && (!spotifyData || !spotifyAccessToken)) {
      console.log('SpotifyRoutes: ERROR - Artista sin datos de Spotify');
      return reply.code(400).send({ message: 'Datos de Spotify son requeridos para registro como artista.' });
    }

    try {
      console.log('SpotifyRoutes: Llamando a registerUserWithSpotify');
      const result = await registerUserWithSpotify(
        email, password, role, username, spotifyData, spotifyAccessToken, spotifyRefreshToken
      );
      console.log('SpotifyRoutes: Registro con Spotify exitoso');
      reply.code(201).send(result);
    } catch (error) {
      console.error('SpotifyRoutes: ERROR en registro con Spotify:', error);
      reply.code(error.statusCode || 500).send({ message: error.message || 'Error interno del servidor.' });
    }
  });

  fastify.post('/spotify/refresh', async (request, reply) => {
    console.log('SpotifyRoutes: /spotify/refresh - Request recibido');
    const { refresh_token } = request.body;
    
    if (!refresh_token) {
      return reply.code(400).send({ message: 'Refresh token es requerido.' });
    }

    try {
      // No necesitamos user_id ya que los tokens se manejan en SharedPreferences
      const result = await refreshSpotifyToken(refresh_token);
      console.log('SpotifyRoutes: Token refrescado exitosamente');
      reply.code(200).send(result);
    } catch (error) {
      console.error('SpotifyRoutes: ERROR refrescando token:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al refrescar token.' 
      });
    }
  });
}

export default spotifyRoutes;