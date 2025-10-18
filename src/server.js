// src/server.js
import dotenv from 'dotenv';
dotenv.config();
import fastify from 'fastify';
import { PORT } from './utils/config.js';
import { createTables } from './db/schema.js';
import corsPlugin from './plugins/cors.js';
import authRoutes from './routes/authRoutes.js';
import authPlugin from './plugins/authPlugin.js';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import radioRoutes from './routes/radioRoutes.js';
import musicRoutes from './routes/musicRoutes.js';
import { dirname, join } from 'path';
import fastifyMultipart from '@fastify/multipart';
import fastifyCompress from '@fastify/compress';
import spotifyRoutes from './routes/spotifyRoutes.js';
import { serverAdapter, authenticateBullBoard } from './config/bullBoard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const server = fastify({
  logger: true
});

// Registrar plugins y rutas en cadena para asegurar el orden
server.register(fastifyCompress); 
server.register(corsPlugin)
      .register(authPlugin)
      .register(authRoutes, { prefix: '/api' });

server.register(fastifyMultipart, {
  limits: {
    fileSize: 1024 * 1024 * 50,
    files: 2
  }
});

server.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
  decorateReply: false
});

// --- Registrar Bull Board (Dashboard de colas) ---
await server.register(serverAdapter.registerPlugin(), {
  prefix: '/admin/queues',
  basePath: '/admin/queues'
});

// Hook de autenticación para Bull Board
server.addHook('preHandler', async (request, reply) => {
  if (request.url.startsWith('/admin/queues')) {
    await authenticateBullBoard(request, reply);
  }
});

// --- Registrar las rutas del Módulo Radio ---
server.register(radioRoutes, { prefix: '/api/radio' });

// Registra las rutas de música
server.register(musicRoutes, { prefix: '/api' });

server.register(spotifyRoutes, { prefix: '/api' });
console.log('Servidor: Rutas de Spotify registradas en /api');

// Ruta de prueba
server.get('/', async (request, reply) => {
  return { hello: 'world', message: 'Backend Fastify de Merfame activo.' };
});

// Función para iniciar el servidor
const startServer = async () => {
  try {
    // Crear tablas de la base de datos al iniciar
    createTables();

    // Iniciar el servidor
    await server.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

startServer();