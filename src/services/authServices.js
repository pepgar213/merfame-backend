// src/services/authServices.js
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { query, run, get } from '../db/queryHelper.js';
import { generateToken } from '../utils/jwt.js';
import { sendVerificationEmail } from './emailService.js';
import { getSpotifyArtist } from './spotifyServices.js';

// ==========================================
// REGISTER USER
// ==========================================
export const registerUser = async (email, password, role, username) => {
  console.log('Registering user with username:', username);

  // Validar que el rol sea uno de los permitidos
  if (!['listener', 'artist'].includes(role)) {
    throw { statusCode: 400, message: 'Rol inválido. Los roles permitidos son "listener" o "artist".' };
  }

  // Validar que el username esté presente
  if (!username) {
    throw { statusCode: 400, message: 'El nombre de usuario es requerido.' };
  }

  // Verificar si el usuario ya existe
  const existingUser = await get(
    'SELECT * FROM users WHERE email = ? OR username = ?',
    [email, username]
  );

  if (existingUser) {
    if (existingUser.email === email) {
      console.log('Found existing user with username:', existingUser.username);
      throw { statusCode: 409, message: 'El email ya está registrado.' };
    }
    if (existingUser.username === username) {
      throw { statusCode: 409, message: 'El nombre de usuario ya está en uso.' };
    }
  }

  // Hashear la contraseña
  const hashedPassword = await bcrypt.hash(password, 10);
  
  // Generar token de verificación
  const verificationToken = crypto.randomBytes(32).toString('hex');

  // Insertar nuevo usuario en la base de datos
  const result = await run(
    `INSERT INTO users (email, password, role, username, verification_token) VALUES (?, ?, ?, ?, ?)`,
    [email, hashedPassword, role, username, verificationToken]
  );

  const userId = result.lastID;

  // Si el rol es 'artist', crea también un perfil de artista
  if (role === 'artist') {
    await run(
      `INSERT INTO artists (user_id, name) VALUES (?, ?)`,
      [userId, username]
    );
    console.log(`Perfil de artista creado para el usuario ${userId}: ${username}`);
  }

  // Enviar email de verificación
  try {
    await sendVerificationEmail(email, verificationToken);
  } catch (emailError) {
    console.error('Error enviando email de verificación:', emailError);
    // Continuar aunque falle el email
  }

  return {
    message: 'Usuario registrado exitosamente. Por favor verifica tu email.',
    userId: userId,
    email: email,
    role: role,
    user_name: username,
    profileImageUrl: null,
    isVerified: false
  };
};

// ==========================================
// REGISTER USER WITH SPOTIFY
// ==========================================
export const registerUserWithSpotify = async (email, password, role, username, spotifyData, spotifyAccessToken, spotifyRefreshToken) => {
  console.log('AuthService: registerUserWithSpotify - Iniciando registro con Spotify');
  
  // Validar que los datos de Spotify estén presentes para artistas
  if (role === 'artist' && (!spotifyData || !spotifyAccessToken)) {
    throw { statusCode: 400, message: 'Datos de Spotify requeridos para registro como artista' };
  }

  const userResult = await registerUser(email, password, role, username);
  console.log('AuthService: Usuario registrado - ID:', userResult.userId);
  
  if (role === 'artist' && spotifyData) {
    console.log('AuthService: Actualizando artista con datos de Spotify (incluyendo popularidad)');
    
    // Obtener popularidad del artista si es posible
    let popularity = null;
    if (spotifyData.id && spotifyAccessToken) {
      try {
        const artistDetails = await getSpotifyArtist(spotifyAccessToken, spotifyData.id);
        popularity = artistDetails.popularity;
        console.log('AuthService: Popularidad obtenida:', popularity);
      } catch (error) {
        console.error('AuthService: Error obteniendo popularidad:', error.message);
        // Continuar sin popularidad si hay error
      }
    }
    
    const spotifyInfo = {
      spotify_id: spotifyData.id,
      spotify_profile_url: spotifyData.external_urls?.spotify,
      spotify_display_name: spotifyData.display_name,
      spotify_email: spotifyData.email,
      spotify_country: spotifyData.country,
      spotify_followers: spotifyData.followers?.total,
      spotify_images: spotifyData.images ? JSON.stringify(spotifyData.images) : null,
      spotify_uri: spotifyData.uri,
      spotify_popularity: popularity
    };
    
    await updateArtistWithSpotifyData(userResult.userId, spotifyInfo);
    console.log('AuthService: Datos de Spotify guardados EXITOSAMENTE (con popularidad)');
  }
  
  return userResult;
};

// ==========================================
// GET ARTIST BY SPOTIFY ID
// ==========================================
export const getArtistBySpotifyId = async (spotifyId) => {
  const artist = await get('SELECT * FROM artists WHERE spotify_id = ?', [spotifyId]);
  return artist;
};

// ==========================================
// LOGIN USER
// ==========================================
export const loginUser = async (identifier, password) => {
  console.log('Login attempt for identifier:', identifier);

  // Query to check both email and username
  const user = await get(
    'SELECT * FROM users WHERE email = ? OR username = ?',
    [identifier, identifier]
  );

  if (!user) {
    console.log('No user found for identifier:', identifier);
    throw { statusCode: 401, message: 'Credenciales inválidas.' };
  }

  console.log('User found with username:', user.username);

  // Verificar si el email está verificado
  if (!user.is_verified) {
    throw { 
      statusCode: 401, 
      message: 'Por favor verifica tu email antes de iniciar sesión. Revisa tu bandeja de entrada.' 
    };
  }

  // Comparar contraseña
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    throw { statusCode: 401, message: 'Credenciales inválidas.' };
  }

  // Generate JWT
  const token = generateToken({ 
    id: user.id, 
    email: user.email, 
    role: user.role, 
    userName: user.username
  });

  return {
    message: 'Inicio de sesión exitoso.',
    userId: user.id,
    token: token,
    email: user.email,
    role: user.role,
    user_name: user.username,
    profileImageUrl: null,
    isVerified: true
  };
};

// ==========================================
// VERIFY EMAIL
// ==========================================
export const verifyEmail = async (token) => {
  if (!token) {
    throw { statusCode: 400, message: 'Token de verificación requerido.' };
  }

  // Buscar usuario con el token de verificación
  const user = await get('SELECT * FROM users WHERE verification_token = ?', [token]);

  if (!user) {
    throw { statusCode: 400, message: 'Token de verificación inválido o expirado.' };
  }

  // Actualizar usuario como verificado y eliminar el token
  await run(
    'UPDATE users SET is_verified = ?, verification_token = NULL WHERE id = ?',
    [true, user.id]
  );

  return { 
    message: 'Email verificado exitosamente. Ya puedes iniciar sesión.',
    userId: user.id,
    email: user.email
  };
};

// ==========================================
// RESEND VERIFICATION EMAIL
// ==========================================
export const resendVerificationEmail = async (email) => {
  if (!email) {
    throw { statusCode: 400, message: 'Email requerido.' };
  }

  // Buscar usuario por email
  const user = await get('SELECT * FROM users WHERE email = ?', [email]);

  if (!user) {
    throw { statusCode: 404, message: 'No existe una cuenta con este email.' };
  }

  if (user.is_verified) {
    throw { statusCode: 400, message: 'Este email ya está verificado.' };
  }

  // Generar nuevo token de verificación
  const newVerificationToken = crypto.randomBytes(32).toString('hex');

  // Actualizar token en la base de datos
  await run(
    'UPDATE users SET verification_token = ? WHERE id = ?',
    [newVerificationToken, user.id]
  );

  // Enviar email de verificación
  try {
    await sendVerificationEmail(email, newVerificationToken);
  } catch (emailError) {
    console.error('Error enviando email de verificación:', emailError);
    throw { 
      statusCode: 500, 
      message: 'Error al enviar el email de verificación. Por favor intenta más tarde.' 
    };
  }

  return { 
    message: 'Email de verificación reenviado. Por favor revisa tu bandeja de entrada.',
    email: email
  };
};

// ==========================================
// UPDATE ARTIST WITH SPOTIFY DATA
// ==========================================
export const updateArtistWithSpotifyData = async (userId, spotifyData) => {
  await run(
    `UPDATE artists SET 
    spotify_id = ?, 
    spotify_profile_url = ?,
    spotify_display_name = ?,
    spotify_email = ?,
    spotify_country = ?,
    spotify_followers = ?,
    spotify_images = ?,
    spotify_uri = ?,
    spotify_popularity = ?
    WHERE user_id = ?`,
    [
      spotifyData.spotify_id,
      spotifyData.spotify_profile_url,
      spotifyData.spotify_display_name,
      spotifyData.spotify_email,
      spotifyData.spotify_country,
      spotifyData.spotify_followers,
      spotifyData.spotify_images,
      spotifyData.spotify_uri,
      spotifyData.spotify_popularity || null,
      userId
    ]
  );

  return { message: 'Datos de Spotify guardados exitosamente.' };
};

// ==========================================
// GET ARTIST BY USER ID
// ==========================================
export const getArtistByUserId = async (userId) => {
  const artist = await get('SELECT * FROM artists WHERE user_id = ?', [userId]);
  return artist;
};

// ==========================================
// UPDATE USER ROLE
// ==========================================
export const updateUserRole = async (userId, newRole) => {
  if (!['listener', 'artist'].includes(newRole)) {
    throw { statusCode: 400, message: 'Rol inválido. Los roles permitidos son "listener" o "artist".' };
  }

  const result = await run('UPDATE users SET role = ? WHERE id = ?', [newRole, userId]);

  if (result.changes === 0) {
    throw { statusCode: 404, message: 'Usuario no encontrado o rol ya establecido.' };
  }

  return { message: 'Rol de usuario actualizado exitosamente.' };
};