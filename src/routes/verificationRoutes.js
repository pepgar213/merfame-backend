// src/routes/verificationRoutes.js
import { 
  generateVerificationCode,
  verifyArtistCode,
  getVerificationStatus,
  getUserVerificationCodes
} from '../services/verificationCodeService.js';

async function verificationRoutes(fastify, options) {
  console.log('VerificationRoutes: Registrando rutas de verificación');

  // ====== RUTAS PÚBLICAS (sin autenticación - para registro) ======
  
  fastify.get('/generate-code', async (request, reply) => {
    console.log('VerificationRoutes: /generate-code - Generando código');
    try {
      const result = await generateVerificationCode();
      console.log('VerificationRoutes: Código generado exitosamente:', result.code);
      reply.code(200).send(result);
    } catch (error) {
      console.error('VerificationRoutes: ERROR generando código:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error generando código de verificación' 
      });
    }
  });

  fastify.post('/verify', async (request, reply) => {
    console.log('VerificationRoutes: /verify - Iniciando verificación');
    const { code, platform, url } = request.body;
    
    console.log('VerificationRoutes: code:', code);
    console.log('VerificationRoutes: platform:', platform);
    console.log('VerificationRoutes: url:', url ? url.substring(0, 50) + '...' : 'NULL');

    if (!code || !platform || !url) {
      return reply.code(400).send({ 
        message: 'Código, plataforma y URL son requeridos.' 
      });
    }

    try {
      const result = await verifyArtistCode(code, platform, url);
      console.log('VerificationRoutes: Verificación encolada exitosamente');
      reply.code(202).send(result);
    } catch (error) {
      console.error('VerificationRoutes: ERROR en verificación:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al iniciar verificación' 
      });
    }
  });

  fastify.get('/status/:jobId', async (request, reply) => {
    console.log('VerificationRoutes: /status - Consultando estado');
    const { jobId } = request.params;
    
    if (!jobId) {
      return reply.code(400).send({ message: 'Job ID requerido.' });
    }

    try {
      const result = await getVerificationStatus(jobId);
      console.log('VerificationRoutes: Estado obtenido:', result.status);
      reply.code(200).send(result);
    } catch (error) {
      console.error('VerificationRoutes: ERROR obteniendo estado:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al obtener estado de verificación' 
      });
    }
  });

  // ====== RUTAS PROTEGIDAS (con autenticación) ======
  
  fastify.get('/my-codes', { 
    preHandler: [fastify.authenticate] 
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const codes = await getUserVerificationCodes(userId);
      reply.code(200).send({ codes });
    } catch (error) {
      console.error('VerificationRoutes: ERROR obteniendo códigos:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al obtener códigos' 
      });
    }
  });
}

export default verificationRoutes;