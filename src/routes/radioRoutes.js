// src/routes/radioRoutes.js
import { getNextSong, likeSong, dislikeSong, followArtist, unfollowArtist } from '../services/radioServices.js';
import zlib from 'zlib'; // Importar el módulo zlib para la compresión
import { promisify } from 'util'; // Para usar zlib.gzip con async/await

const gzip = promisify(zlib.gzip);

async function radioRoutes (fastify, options) {
  // Ruta para obtener la siguiente canción
  fastify.get('/next-song', async (request, reply) => {
    try {
      const artistId = request.query.artistId;
      const song = await getNextSong(artistId);

      if (song) {
        // Convertir el objeto de la canción a una cadena JSON
        const jsonString = JSON.stringify(song);
        
        // Comprimir la cadena JSON con Gzip de forma asíncrona
        const compressedData = await gzip(jsonString);

        // Establecer el encabezado para informar al cliente que el contenido está comprimido
        reply.header('Content-Encoding', 'gzip');
        
        // Enviar los datos comprimidos
        reply.code(200).send(compressedData);
      } else {
        reply.code(404).send({ message: 'No hay canciones disponibles.' });
      }
    } catch (error) {
      reply.code(error.statusCode || 500).send({ message: error.message || 'Error interno del servidor al obtener canción.' });
    }
  });

  // El resto de las rutas no se modifican, ya que manejan payloads pequeños.
  fastify.post('/like-song', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const {
      songId
    } = request.body;
    const userId = request.user.id;

    if (!songId) {
      return reply.status(400).send({
        message: 'Se requiere el ID de la canción.'
      });
    }

    try {
      const result = await likeSong(userId, songId);
      reply.send(result);
    } catch (error) {
      console.error(`Error en la ruta /like-song para el usuario ${userId} y canción ${songId}:`, error);
      reply.status(error.statusCode || 500).send({
        message: error.message || 'Error interno del servidor al dar "me gusta" a la canción.'
      });
    }
  });

  fastify.post('/dislike-song', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const {
      songId
    } = request.body;
    const userId = request.user.id;

    if (!songId) {
      return reply.status(400).send({
        message: 'Se requiere el ID de la canción.'
      });
    }

    try {
      const result = await dislikeSong(userId, songId);
      reply.send(result);
    } catch (error) {
      console.error(`Error en la ruta /dislike-song para el usuario ${userId} y canción ${songId}:`, error);
      reply.status(error.statusCode || 500).send({
        message: error.message || 'Error interno del servidor al dar "no me gusta" a la canción.'
      });
    }
  });

  fastify.post('/follow-artist', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const {
      artistId
    } = request.body;
    const userId = request.user.id;

    if (!artistId) {
      return reply.status(400).send({
        message: 'Se requiere el ID del artista.'
      });
    }

    try {
      const result = await followArtist(userId, artistId);
      reply.send(result);
    } catch (error) {
      console.error(`Error en la ruta /follow-artist para el usuario ${userId} y artista ${artistId}:`, error);
      reply.status(error.statusCode || 500).send({
        message: error.message || 'Error interno del servidor al seguir al artista.'
      });
    }
  });

  fastify.post('/unfollow-artist', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const {
      artistId
    } = request.body;
    const userId = request.user.id;

    if (!artistId) {
      return reply.status(400).send({
        message: 'Se requiere el ID del artista.'
      });
    }

    try {
      const result = await unfollowArtist(userId, artistId);
      reply.send(result);
    } catch (error) {
      console.error(`Error en la ruta /unfollow-artist para el usuario ${userId} y artista ${artistId}:`, error);
      reply.status(error.statusCode || 500).send({
        message: error.message || 'Error interno del servidor al dejar de seguir al artista.'
      });
    }
  });
}

export default radioRoutes;