// src/routes/radioRoutes.js
import { getNextSong, likeSong, dislikeSong, followArtist, unfollowArtist } from '../services/radioServices.js';

// ❌ ELIMINAR ESTAS LÍNEAS (ya no necesitamos compresión manual)
// import zlib from 'zlib';
// import { promisify } from 'util';
// const gzip = promisify(zlib.gzip);

async function radioRoutes (fastify, options) {
  // ✅ CORREGIDO: Enviar JSON sin comprimir
  fastify.get('/next-song', async (request, reply) => {
    try {
      const artistId = request.query.artistId;
      const song = await getNextSong(artistId);

      if (song) {
        // ✅ Enviar directamente como JSON (sin compresión manual)
        reply.code(200).send(song);
      } else {
        reply.code(404).send({ message: 'No hay canciones disponibles.' });
      }
    } catch (error) {
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error interno del servidor al obtener canción.' 
      });
    }
  });

  // Las demás rutas (like-song, dislike-song, etc.) permanecen igual
  fastify.post('/like-song', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { songId } = request.body;
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
    const { songId } = request.body;
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
    const { artistId } = request.body;
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
    const { artistId } = request.body;
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