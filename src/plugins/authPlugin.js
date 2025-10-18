// src/plugins/authPlugin.js (No requiere cambios adicionales para esta corrección, pero revisado para referencia)
import fp from 'fastify-plugin';
import { verifyToken } from '../utils/jwt.js';

async function authPlugin (fastify, options) {
  fastify.decorate('authenticate', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({ message: 'Token de autenticación requerido.' });
      throw new new Error('Unauthorized: No token or invalid format.');
    }

    const token = authHeader.split(' ')[1];

    // NUEVO: Verificar si el token es undefined y imprimirlo
    if (typeof token === 'undefined') {
      console.log('El token es undefined antes de la verificación.');
    } else {
      console.log('Token a verificar:', token);
    }

    const { success, decoded, error } = verifyToken(token); // Ahora verifyToken devuelve un objeto manejable

    if (!success) {
      if (error === 'jwt expired') { // Este caso ya no debería ocurrir si no hay expiración
        reply.code(401).send({ message: 'Token de autenticación expirado.' });
      } else {
        reply.code(401).send({ message: `Token inválido: ${error}` }); // ¡Ahora 'error' tendrá un mensaje real!
      }
      throw new Error(`Unauthorized: ${error}`);
    }

    request.user = decoded;
  });
}

export default fp(authPlugin);