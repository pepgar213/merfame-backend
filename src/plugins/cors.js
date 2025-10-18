import fp from 'fastify-plugin';
import fastifyCors from '@fastify/cors';

async function corsPlugin(fastify, options) {
  // Leer orígenes permitidos desde .env
  const allowedOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
    : ['http://localhost:3000']; // Fallback solo para desarrollo

  fastify.register(fastifyCors, {
    origin: allowedOrigins,  // ✅ Desde .env
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  });
}

export default fp(corsPlugin);