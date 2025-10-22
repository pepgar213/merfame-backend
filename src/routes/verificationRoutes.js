// src/routes/verificationRoutes.js
// ACTUALIZADO: Ahora usa el sistema de verificación manual
import { 
  generateVerificationCode,
  submitVerificationRequest,
  getVerificationStatus
} from '../services/verificationManualService.js';

async function verificationRoutes(fastify, options) {
  console.log('VerificationRoutes: Registrando rutas de verificación (SISTEMA MANUAL)');

  // ====== RUTAS PÚBLICAS (sin autenticación - para registro) ======
  
  /**
   * GET /verification/generate-code
   * Genera un nuevo código de verificación
   * SIN CAMBIOS - Funciona igual que antes
   */
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

  /**
   * POST /verification/verify
   * Envía una solicitud de verificación para revisión manual
   * MODIFICADO: Ya no hace scraping automático, solo guarda la solicitud
   */
  fastify.post('/verify', async (request, reply) => {
    console.log('VerificationRoutes: /verify - Enviando solicitud de verificación manual');
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
      // CAMBIO PRINCIPAL: Ya no se encola para scraping, solo se guarda
      const result = await submitVerificationRequest(code, platform, url);
      console.log('VerificationRoutes: Solicitud guardada para revisión manual');
      
      // Devolver 202 (Accepted) porque será procesada más tarde por un admin
      reply.code(202).send({
        ...result,
        note: 'Tu solicitud será revisada por un administrador en las próximas 24-48 horas.'
      });
    } catch (error) {
      console.error('VerificationRoutes: ERROR en verificación:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al enviar solicitud de verificación' 
      });
    }
  });

  /**
   * GET /verification/status/:code
   * Consulta el estado de una verificación
   * SIN CAMBIOS MAYORES - Solo retorna el estado actual
   */
  fastify.get('/status/:code', async (request, reply) => {
    console.log('VerificationRoutes: /status - Consultando estado');
    const { code } = request.params;
    
    if (!code) {
      return reply.code(400).send({ message: 'Código requerido.' });
    }

    try {
      const result = await getVerificationStatus(code);
      console.log('VerificationRoutes: Estado obtenido:', result.status);
      
      // Añadir mensaje descriptivo según el estado
      let statusMessage = '';
      switch (result.status) {
        case 'pending':
          statusMessage = 'Código generado pero aún no se ha enviado la URL de verificación';
          break;
        case 'awaiting_review':
          statusMessage = 'Tu solicitud está siendo revisada por un administrador';
          break;
        case 'verified':
          statusMessage = 'Verificación aprobada exitosamente';
          break;
        case 'failed':
          statusMessage = 'Verificación rechazada';
          break;
        case 'expired':
          statusMessage = 'El código ha expirado. Genera uno nuevo.';
          break;
        default:
          statusMessage = 'Estado desconocido';
      }
      
      reply.code(200).send({
        ...result,
        statusMessage
      });
    } catch (error) {
      console.error('VerificationRoutes: ERROR obteniendo estado:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al obtener estado de verificación' 
      });
    }
  });
}

export default verificationRoutes;