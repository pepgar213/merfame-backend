// src/services/emailService.js
import { Resend } from 'resend';
import { BASE_URL, RESEND_API_KEY, RESEND_FROM } from '../utils/config.js';

const resend = new Resend(RESEND_API_KEY);

// Verificación de configuración
if (!RESEND_API_KEY) {
  console.error('⚠️  ADVERTENCIA: RESEND_API_KEY no está configurada');
} else {
  console.log('✅ Resend configurado correctamente');
}

export const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `${BASE_URL}/api/verify-email?token=${token}`;
  
  try {
    console.log('🔄 Enviando email de verificación a:', email);
    
    const response = await resend.emails.send({
      from: RESEND_FROM,
      to: email,
      subject: 'Verifica tu cuenta en Merfame',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Verifica tu cuenta - Merfame</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
                .container { max-width: 600px; margin: 0 auto; background-color: #fff; }
                .header { background-color: #FF5000; padding: 20px; text-align: center; color: white; }
                .content { padding: 30px; line-height: 1.6; }
                .button { display: inline-block; background-color: #FF5000; color: white; padding: 14px 30px; text-decoration: none; border-radius: 4px; font-weight: bold; margin: 20px 0; }
                .footer { background-color: #333; color: white; padding: 20px; text-align: center; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>¡Bienvenido a Merfame! 🎵</h1>
                </div>
                <div class="content">
                    <p>Estás a un paso de comenzar. Por favor verifica tu email haciendo clic aquí:</p>
                    <div style="text-align: center;">
                        <a href="${verificationUrl}" class="button">Verificar mi email</a>
                    </div>
                    <p>O copia esta URL en tu navegador:</p>
                    <p style="word-break: break-all; color: #FF5000;">${verificationUrl}</p>
                    <p><strong>Nota:</strong> Este enlace expirará en 24 horas.</p>
                </div>
                <div class="footer">
                    <p>© 2025 Merfame. Todos los derechos reservados.</p>
                </div>
            </div>
        </body>
        </html>
      `,
    });

    // ✅ Manejar el formato de respuesta de Resend correctamente
    const emailId = response?.data?.id || response?.id;
    
    if (response?.error) {
      throw new Error(`Error de Resend: ${JSON.stringify(response.error)}`);
    }
    
    if (!emailId) {
      console.error('⚠️  Respuesta inesperada de Resend:', JSON.stringify(response));
      throw new Error('Resend no devolvió un ID válido');
    }

    console.log('✅ Email de verificación enviado exitosamente');
    console.log('📧 Resend ID:', emailId);
    
    return response;
  } catch (error) {
    console.error('❌ Error enviando email de verificación:', error.message);
    
    // Si el error tiene información adicional de Resend
    if (error.statusCode) {
      console.error('❌ Resend Status Code:', error.statusCode);
    }
    
    throw new Error(`No se pudo enviar el email de verificación: ${error.message}`);
  }
};
