// src/routes/authRoutes.js
import { 
  registerUser, 
  loginUser, 
  updateUserRole, 
  verifyEmail,
  resendVerificationEmail 
} from '../services/authServices.js';

// Función plugin para las rutas de autenticación
async function authRoutes (fastify, options) {

  // Ruta de Registro
  fastify.post('/register', async (request, reply) => {
    const { email, password, role, username } = request.body;

    console.log('Rol recibido en authRoutes:', role); 

    if (!email || !password || !role || !username) {
      return reply.code(400).send({ message: 'Email, contraseña, nombre de usuario y rol son requeridos.' });
    }

    try {
      const result = await registerUser(email, password, role, username);
      reply.code(201).send(result);
    } catch (error) {
      console.error('Error durante el registro en authRoutes:', error);
      reply.code(error.statusCode || 500).send({ message: error.message || 'Error interno del servidor.' });
    }
  });

  // Ruta de Login
  fastify.post('/login', async (request, reply) => {
    const { identifier, password } = request.body; // Changed from 'email' to 'identifier'

    if (!identifier || !password) {
        return reply.code(400).send({ message: 'Email/username y contraseña son requeridos.' });
    }

    try {
      const result = await loginUser(identifier, password);
      reply.code(200).send(result);
    } catch (error) {
        reply.code(error.statusCode || 500).send({ message: error.message || 'Error interno del servidor.' });
    }
  });

  // Ruta para verificar email
  fastify.get('/verify-email', async (request, reply) => {
    const { token } = request.query;

    if (!token) {
      return reply.code(400).send({ message: 'Token de verificación requerido.' });
    }

    try {
      const result = await verifyEmail(token);
      reply.code(200).send(result);
    } catch (error) {
      reply.code(error.statusCode || 500).send({ message: error.message || 'Error interno del servidor.' });
    }
  });

  // Ruta para reenviar email de verificación
  fastify.post('/resend-verification', async (request, reply) => {
    const { email } = request.body;

    if (!email) {
      return reply.code(400).send({ message: 'Email requerido.' });
    }

    try {
      const result = await resendVerificationEmail(email);
      reply.code(200).send(result);
    } catch (error) {
      reply.code(error.statusCode || 500).send({ message: error.message || 'Error interno del servidor.' });
    }
  });

  // Ruta para Actualizar el Rol del Usuario
  fastify.put('/user/role', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { role } = request.body;
    const userId = request.user.id;

    if (!role) {
      return reply.code(400).send({ message: 'El rol es requerido.' });
    }

    try {
      await updateUserRole(userId, role);
      reply.code(200).send({ message: 'Rol de usuario actualizado exitosamente.' });
    } catch (error) {
      reply.code(error.statusCode || 500).send({ message: error.message || 'Error interno del servidor.' });
    }
  });
}

// Exporta la función de rutas
export default authRoutes;
