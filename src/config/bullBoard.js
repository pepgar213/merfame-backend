// src/config/bullBoard.js
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { songQueue } from '../workers/songProcessor.js';
import { verificationQueue } from '../workers/verificationProcessor.js';

// Crear el adaptador de Fastify
const serverAdapter = new FastifyAdapter();
serverAdapter.setBasePath('/admin/queues');

// Crear el dashboard con todas las colas
createBullBoard({
  queues: [
    new BullAdapter(songQueue),
    new BullAdapter(verificationQueue)  // ✅ NUEVA COLA
  ],
  serverAdapter
});

// Middleware de autenticación básica
const authenticateBullBoard = async (request, reply) => {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    reply.header('WWW-Authenticate', 'Basic realm="Bull Board"');
    return reply.code(401).send({ message: 'Autenticación requerida' });
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  const ADMIN_USERNAME = process.env.BULL_BOARD_USERNAME;
  const ADMIN_PASSWORD = process.env.BULL_BOARD_PASSWORD;

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    reply.header('WWW-Authenticate', 'Basic realm="Bull Board"');
    return reply.code(401).send({ message: 'Credenciales inválidas' });
  }
};

export { serverAdapter, authenticateBullBoard };