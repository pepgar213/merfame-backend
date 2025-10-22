// src/routes/adminVerificationRoutes.js
import { 
  getPendingVerifications,
  approveVerification,
  rejectVerification,
  getAllVerifications,
  getVerificationStatus
} from '../services/verificationManualService.js';
import { query } from '../db/queryHelper.js';

/**
 * Rutas de administración para verificación manual de artistas
 * Estas rutas deben estar protegidas con autenticación de admin
 */
async function adminVerificationRoutes(fastify, options) {
  console.log('AdminVerificationRoutes: Registrando rutas de administración');

  // Middleware para verificar que el usuario es administrador
  const verifyAdmin = async (request, reply) => {
    // Primero autenticar (usando el middleware de authPlugin)
    await fastify.authenticate(request, reply);
    
    // Luego verificar rol de admin
    if (!request.user) {
      return reply.code(401).send({ message: 'Autenticación requerida' });
    }

    console.log('AdminVerificationRoutes: Usuario autenticado:', request.user.email, 'Rol:', request.user.role);

    if (request.user.role !== 'admin' && request.user.role !== 'moderator') {
      console.log('AdminVerificationRoutes: Acceso denegado - Rol insuficiente');
      return reply.code(403).send({ 
        message: 'No tienes permisos de administrador para acceder a esta sección' 
      });
    }
    
    console.log('AdminVerificationRoutes: Acceso concedido');
  };

  // Aplicar middleware de admin a todas las rutas
  fastify.addHook('preHandler', verifyAdmin);

  /**
   * GET /admin/verifications/stats
   * Obtiene estadísticas de verificaciones
   * IMPORTANTE: Esta ruta debe estar ANTES de /:id para evitar conflictos
   */
  fastify.get('/stats', async (request, reply) => {
    console.log('AdminVerificationRoutes: /stats - Obteniendo estadísticas');
    console.log('AdminVerificationRoutes: Usuario:', request.user?.email, 'Rol:', request.user?.role);
    
    try {
      const stats = await query(`
        SELECT 
          status,
          COUNT(*) as count
        FROM artist_verification_codes
        GROUP BY status
      `);
      
      console.log('AdminVerificationRoutes: Stats raw:', stats);

      const statsObj = {
        total: 0,
        pending: 0,
        awaiting_review: 0,
        verified: 0,
        failed: 0,
        expired: 0
      };

      stats.forEach(stat => {
        statsObj[stat.status] = stat.count;
        statsObj.total += stat.count;
      });
      
      console.log('AdminVerificationRoutes: Stats procesadas:', statsObj);

      reply.code(200).send(statsObj);
    } catch (error) {
      console.error('AdminVerificationRoutes: ERROR obteniendo estadísticas:', error);
      reply.code(500).send({ 
        message: 'Error al obtener estadísticas' 
      });
    }
  });

  /**
   * GET /admin/verifications/pending
   * Obtiene todas las verificaciones pendientes de revisión
   */
  fastify.get('/pending', async (request, reply) => {
    console.log('AdminVerificationRoutes: /pending - Obteniendo pendientes');
    try {
      const pending = await getPendingVerifications();
      console.log(`AdminVerificationRoutes: ${pending.length} verificaciones pendientes`);
      reply.code(200).send({
        count: pending.length,
        verifications: pending
      });
    } catch (error) {
      console.error('AdminVerificationRoutes: ERROR obteniendo pendientes:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al obtener verificaciones pendientes' 
      });
    }
  });

  /**
   * GET /admin/verifications
   * Obtiene todas las verificaciones con filtros opcionales
   */
  fastify.get('/', async (request, reply) => {
    console.log('AdminVerificationRoutes: / - Obteniendo todas');
    const { status, limit } = request.query;
    
    try {
      const verifications = await getAllVerifications(
        status || null, 
        parseInt(limit) || 50
      );
      
      reply.code(200).send({
        count: verifications.length,
        filters: { status: status || 'all', limit: limit || 50 },
        verifications: verifications
      });
    } catch (error) {
      console.error('AdminVerificationRoutes: ERROR obteniendo todas:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al obtener verificaciones' 
      });
    }
  });

  /**
   * GET /admin/verifications/:id
   * Obtiene los detalles de una verificación específica
   */
  fastify.get('/:id', async (request, reply) => {
    console.log('AdminVerificationRoutes: /:id - Obteniendo detalles');
    const { id } = request.params;
    
    if (!id) {
      return reply.code(400).send({ message: 'ID de verificación requerido' });
    }

    try {
      const verification = await query(
        'SELECT * FROM artist_verification_codes WHERE id = ?',
        [id]
      );

      if (!verification || verification.length === 0) {
        return reply.code(404).send({ message: 'Verificación no encontrada' });
      }

      reply.code(200).send(verification[0]);
    } catch (error) {
      console.error('AdminVerificationRoutes: ERROR obteniendo detalles:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al obtener detalles de verificación' 
      });
    }
  });

  /**
   * POST /admin/verifications/:id/approve
   * Aprueba manualmente una verificación
   */
  fastify.post('/:id/approve', async (request, reply) => {
    console.log('AdminVerificationRoutes: /:id/approve - Aprobando verificación');
    const { id } = request.params;
    const { notes } = request.body;
    
    console.log('AdminVerificationRoutes: ID:', id);
    console.log('AdminVerificationRoutes: Notes:', notes);
    console.log('AdminVerificationRoutes: Usuario:', request.user?.username);
    
    if (!id) {
      return reply.code(400).send({ message: 'ID de verificación requerido' });
    }

    try {
      const result = await approveVerification(parseInt(id), notes || null);
      console.log(`AdminVerificationRoutes: Verificación ${id} aprobada por ${request.user.username}`);
      
      reply.code(200).send({
        ...result,
        approvedBy: request.user.username,
        approvedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('AdminVerificationRoutes: ERROR aprobando:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al aprobar verificación' 
      });
    }
  });

  /**
   * POST /admin/verifications/:id/reject
   * Rechaza manualmente una verificación
   */
  fastify.post('/:id/reject', async (request, reply) => {
    console.log('AdminVerificationRoutes: /:id/reject - Rechazando verificación');
    const { id } = request.params;
    const { reason } = request.body;
    
    if (!id) {
      return reply.code(400).send({ message: 'ID de verificación requerido' });
    }

    if (!reason || reason.trim() === '') {
      return reply.code(400).send({ 
        message: 'Debe proporcionar un motivo de rechazo' 
      });
    }

    try {
      const result = await rejectVerification(parseInt(id), reason);
      console.log(`AdminVerificationRoutes: Verificación ${id} rechazada por ${request.user.username}`);
      
      reply.code(200).send({
        ...result,
        rejectedBy: request.user.username,
        rejectedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('AdminVerificationRoutes: ERROR rechazando:', error);
      reply.code(error.statusCode || 500).send({ 
        message: error.message || 'Error al rechazar verificación' 
      });
    }
  });
}

export default adminVerificationRoutes;
