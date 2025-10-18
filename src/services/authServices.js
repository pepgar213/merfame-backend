// src/services/authService.js
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import db from '../db/index.js'; // Importa la instancia de la base de datos
import { generateToken } from '../utils/jwt.js'; // Importa la función de generación de token
import { sendVerificationEmail } from './emailService.js'; // Importa el servicio de email
import { getSpotifyArtist } from './spotifyServices.js'; 

// Función para registrar un nuevo usuario (AHORA CON EL PARÁMETRO 'role')
export const registerUser = async (email, password, role, username) => {
  console.log('Registering user with username:', username);
  return new Promise((resolve, reject) => {
    // Validar que el rol sea uno de los permitidos
    if (!['listener', 'artist'].includes(role)) {
      return reject({ statusCode: 400, message: 'Rol inválido. Los roles permitidos son "listener" o "artist".' });
    }

    // Validar que el username esté presente
    if (!username) {
      return reject({ statusCode: 400, message: 'El nombre de usuario es requerido.' });
    }

    // Verificar si el usuario ya existe
    db.get('SELECT * FROM users WHERE email = ? OR username = ?', [email, username], async (err, row) => {
      if (err) {
        console.error("Error al buscar usuario en registro:", err.message);
        return reject({ statusCode: 500, message: 'Error interno del servidor.' });
      }
      if (row) {
        // Usuario ya existe
        if (row.email === email) {
          console.log('Found existing user with username:', row.username);
          return reject({ statusCode: 409, message: 'El email ya está registrado.' });
        }
        if (row.username === username) {
          return reject({ statusCode: 409, message: 'El nombre de usuario ya está en uso.' });
        }
      }

      // Hashear la contraseña
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Generar token de verificación
      const verificationToken = crypto.randomBytes(32).toString('hex');

      // Insertar nuevo usuario en la base de datos
      db.run(`INSERT INTO users (email, password, role, username, verification_token) VALUES (?, ?, ?, ?, ?)`,
        [email, hashedPassword, role, username, verificationToken],
        async function (err) {
          if (err) {
            console.error("Error al insertar nuevo usuario:", err.message);
            return reject({ statusCode: 500, message: 'Error al registrar el usuario.' });
          }
          const userId = this.lastID;

          // Si el rol es 'artist', crea también un perfil de artista
          if (role === 'artist') {
            db.run(`INSERT INTO artists (user_id, name) VALUES (?, ?)`,
              [userId, username],
              async (artistErr) => {
                if (artistErr) {
                  console.error("Error al crear perfil de artista:", artistErr.message);
                  return reject({ statusCode: 500, message: 'Error al crear el perfil de artista. Inténtelo de nuevo.' });
                }
                console.log(`Perfil de artista creado para el usuario ${userId}: ${username}`);
                
                try {
                  // Enviar email de verificación
                  await sendVerificationEmail(email, verificationToken);
                  
                  resolve({
                    message: 'Usuario y perfil de artista registrados exitosamente. Por favor verifica tu email.',
                    userId: userId,
                    email: email,
                    role: role,
                    user_name: username,
                    profileImageUrl: null,
                    isVerified: false
                  });
                } catch (emailError) {
                  console.error('Error enviando email de verificación:', emailError);
                  // Aún así respondemos con éxito, pero informamos al usuario que revise su email
                  resolve({
                    message: 'Usuario registrado, pero hubo un problema enviando el email de verificación. Por favor contacta con soporte.',
                    userId: userId,
                    email: email,
                    role: role,
                    user_name: username,
                    profileImageUrl: null,
                    isVerified: false
                  });
                }
              }
            );
          } else {
            try {
              // Enviar email de verificación
              await sendVerificationEmail(email, verificationToken);
              
              resolve({
                message: 'Usuario registrado exitosamente. Por favor verifica tu email.',
                userId: userId,
                email: email,
                role: role,
                user_name: username,
                profileImageUrl: null,
                isVerified: false
              });
            } catch (emailError) {
              console.error('Error enviando email de verificación:', emailError);
              // Aún así respondemos con éxito, pero informamos al usuario que revise su email
              resolve({
                message: 'Usuario registrado, pero hubo un problema enviando el email de verificación. Por favor contacta con soporte.',
                userId: userId,
                email: email,
                role: role,
                user_name: username,
                profileImageUrl: null,
                isVerified: false
              });
            }
          }
        }
      );
    });
  });
};

export const registerUserWithSpotify = async (email, password, role, username, spotifyData, spotifyAccessToken, spotifyRefreshToken) => {
  try {
    console.log('AuthService: registerUserWithSpotify - Iniciando registro con Spotify');
    
    // Validar que los datos de Spotify estén presentes para artistas
    if (role === 'artist' && (!spotifyData || !spotifyAccessToken)) {
      throw { statusCode: 400, message: 'Datos de Spotify requeridos para registro como artista' };
    }

    const userResult = await registerUser(email, password, role, username);
    console.log('AuthService: Usuario registrado - ID:', userResult.userId);
    
    if (role === 'artist' && spotifyData) {
      console.log('AuthService: Actualizando artista con datos de Spotify (incluyendo popularidad)');
      
      // ✅ OBTENER POPULARIDAD DEL ARTISTA SI ES POSIBLE
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
        spotify_popularity: popularity  // ✅ INCLUIR POPULARIDAD
      };
      
      await updateArtistWithSpotifyData(userResult.userId, spotifyInfo);
      console.log('AuthService: Datos de Spotify guardados EXITOSAMENTE (con popularidad)');
    }
    
    return userResult;
  } catch (error) {
    console.error('AuthService: ERROR en registerUserWithSpotify:', error.message);
    throw error;
  }
};

export const getArtistBySpotifyId = async (spotifyId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM artists WHERE spotify_id = ?', [spotifyId], (err, row) => {
      if (err) {
        console.error("Error al obtener artista por Spotify ID:", err.message);
        reject({ statusCode: 500, message: 'Error al obtener artista.' });
      } else {
        resolve(row);
      }
    });
  });
};

// Función para iniciar sesión de un usuario
export const loginUser = async (identifier, password) => {
  console.log('Login attempt for identifier:', identifier);
  return new Promise((resolve, reject) => {
    // Query to check both email and username
    db.get('SELECT * FROM users WHERE email = ? OR username = ?', [identifier, identifier], async (err, user) => {
      if (err) {
        console.error("Error al buscar usuario en login:", err.message);
        return reject({ statusCode: 500, message: 'Error interno del servidor.' });
      }
      if (!user) {
        console.log('No user found for identifier:', identifier);
        return reject({ statusCode: 401, message: 'Credenciales inválidas.' });
      }

      console.log('User found with username:', user.username);

      // Verificar si el email está verificado
      if (!user.is_verified) {
        return reject({ 
          statusCode: 401, 
          message: 'Por favor verifica tu email antes de iniciar sesión. Revisa tu bandeja de entrada.' 
        });
      }

      try {
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
          return reject({ statusCode: 401, message: 'Credenciales inválidas.' });
        }

        // Generate JWT
        const token = generateToken({ id: user.id, email: user.email, role: user.role, userName: user.username});

        resolve({
          message: 'Inicio de sesión exitoso.',
          userId: user.id,
          token: token,
          email: user.email,
          role: user.role,
          user_name: user.username,
          profileImageUrl: null,
          isVerified: true
        });

      } catch (error) {
        reject({ statusCode: 500, message: 'Error al comparar contraseña o generar token.', error: error.message });
      }
    });
  });
};

// Función para verificar email
export const verifyEmail = async (token) => {
  return new Promise((resolve, reject) => {
    if (!token) {
      return reject({ statusCode: 400, message: 'Token de verificación requerido.' });
    }

    // Buscar usuario con el token de verificación
    db.get('SELECT * FROM users WHERE verification_token = ?', [token], (err, user) => {
      if (err) {
        console.error("Error al buscar usuario por token:", err.message);
        return reject({ statusCode: 500, message: 'Error interno del servidor.' });
      }

      if (!user) {
        return reject({ statusCode: 400, message: 'Token de verificación inválido o expirado.' });
      }

      // Actualizar usuario como verificado y eliminar el token
      db.run('UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?', 
        [user.id], 
        function(updateErr) {
          if (updateErr) {
            console.error("Error al actualizar usuario:", updateErr.message);
            return reject({ statusCode: 500, message: 'Error al verificar el email.' });
          }

          resolve({ 
            message: 'Email verificado exitosamente. Ya puedes iniciar sesión.',
            userId: user.id,
            email: user.email
          });
        }
      );
    });
  });
};

// Función para reenviar email de verificación
export const resendVerificationEmail = async (email) => {
  return new Promise((resolve, reject) => {
    if (!email) {
      return reject({ statusCode: 400, message: 'Email requerido.' });
    }

    // Buscar usuario por email
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        console.error("Error al buscar usuario:", err.message);
        return reject({ statusCode: 500, message: 'Error interno del servidor.' });
      }

      if (!user) {
        return reject({ statusCode: 404, message: 'No existe una cuenta con este email.' });
      }

      if (user.is_verified) {
        return reject({ statusCode: 400, message: 'Este email ya está verificado.' });
      }

      // Generar nuevo token de verificación
      const newVerificationToken = crypto.randomBytes(32).toString('hex');

      // Actualizar token en la base de datos
      db.run('UPDATE users SET verification_token = ? WHERE id = ?', 
        [newVerificationToken, user.id], 
        async function(updateErr) {
          if (updateErr) {
            console.error("Error al actualizar token:", updateErr.message);
            return reject({ statusCode: 500, message: 'Error al generar nuevo token de verificación.' });
          }

          try {
            // Enviar email de verificación
            await sendVerificationEmail(email, newVerificationToken);
            
            resolve({ 
              message: 'Email de verificación reenviado. Por favor revisa tu bandeja de entrada.',
              email: email
            });
          } catch (emailError) {
            console.error('Error enviando email de verificación:', emailError);
            reject({ 
              statusCode: 500, 
              message: 'Error al enviar el email de verificación. Por favor intenta más tarde.' 
            });
          }
        }
      );
    });
  });
};

export const updateArtistWithSpotifyData = async (userId, spotifyData) => {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE artists SET 
            spotify_id = ?, 
            spotify_profile_url = ?,
            spotify_display_name = ?,
            spotify_email = ?,
            spotify_country = ?,
            spotify_followers = ?,
            spotify_images = ?,
            spotify_uri = ?,
            spotify_popularity = ?  -- ✅ NUEVO CAMPO
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
                spotifyData.spotify_popularity || null,  // ✅ NUEVO CAMPO
                userId
            ],
            function(err) {
                if (err) {
                    console.error("Error al actualizar artista con datos de Spotify:", err.message);
                    reject({ statusCode: 500, message: 'Error al guardar datos de Spotify.' });
                } else {
                    resolve({ message: 'Datos de Spotify guardados exitosamente.' });
                }
            }
        );
    });
};


// Función para obtener artista por user_id
export const getArtistByUserId = async (userId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM artists WHERE user_id = ?', [userId], (err, row) => {
      if (err) {
        console.error("Error al obtener artista:", err.message);
        reject({ statusCode: 500, message: 'Error al obtener artista.' });
      } else {
        resolve(row);
      }
    });
  });
};


// Nueva función para actualizar el rol del usuario (aunque no se use directamente para registrar artistas inicialmente)
export const updateUserRole = async (userId, newRole) => {
  return new Promise((resolve, reject) => {
    if (!['listener', 'artist'].includes(newRole)) {
      return reject({ statusCode: 400, message: 'Rol inválido. Los roles permitidos son "listener" o "artist".' });
    }

    db.run('UPDATE users SET role = ? WHERE id = ?', [newRole, userId], function (err) {
      if (err) {
        console.error("Error al actualizar rol de usuario:", err.message);
        return reject({ statusCode: 500, message: 'Error interno del servidor.' });
      }
      if (this.changes === 0) {
        return reject({ statusCode: 404, message: 'Usuario no encontrado o rol ya establecido.' });
      }
      resolve({ message: 'Rol de usuario actualizado exitosamente.' });
    });
  });
};
