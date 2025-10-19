export const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `${BASE_URL}/api/verify-email?token=${token}`;
  
  try {
    console.log('🔄 Intentando enviar email a:', email);
    console.log('🔑 RESEND_API_KEY presente:', !!process.env.RESEND_API_KEY);
    console.log('📤 From:', process.env.RESEND_FROM || 'Merfame <onboarding@resend.dev>');
    
    const data = await resend.emails.send({
      from: process.env.RESEND_FROM || 'Merfame <onboarding@resend.dev>',
      to: email,
      subject: 'Verifica tu cuenta en Merfame',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verifica tu cuenta - Merfame</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    margin: 0;
                    padding: 0;
                    background-color: #f5f5f5;
                    color: #333;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    background-color: #FAFAFA;
                }
                .header {
                    background-color: #FAFAFA;
                    padding: 20px;
                    text-align: center;
                }
                .content {
                    padding: 30px;
                    line-height: 1.6;
                }
                .button {
                    display: inline-block;
                    background-color: #FF5000;
                    color: #FAFAFA;
                    padding: 14px 30px;
                    text-decoration: none;
                    border-radius: 4px;
                    font-weight: bold;
                    margin: 20px 0;
                }
                .footer {
                    background-color: #333;
                    color: #FAFAFA;
                    padding: 20px;
                    text-align: center;
                    font-size: 12px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>¡Bienvenido a Merfame! 🎵</h1>
                </div>
                
                <div class="content">
                    <p>Estás a un paso de comenzar. Por favor verifica tu dirección de email haciendo clic en el siguiente enlace:</p>
                    
                    <div style="text-align: center;">
                        <a href="${verificationUrl}" class="button">Verificar mi email</a>
                    </div>
                    
                    <p>O copia y pega esta URL en tu navegador:</p>
                    <p style="color: #FF5000; word-break: break-all;">${verificationUrl}</p>
                    
                    <p><strong>Nota:</strong> Este enlace expirará en 24 horas por seguridad.</p>
                </div>
                
                <div class="footer">
                    <p>© 2025 Merfame. Todos los derechos reservados.</p>
                </div>
            </div>
        </body>
        </html>
      `,
    });

    console.log('✅ Email enviado exitosamente');
    console.log('📧 Resend Response:', JSON.stringify(data, null, 2));
    
    if (!data || !data.id) {
      console.error('⚠️  Resend devolvió respuesta sin ID:', data);
      throw new Error('Resend no devolvió un ID de email válido');
    }
    
    return data;
  } catch (error) {
    console.error('❌ ERROR COMPLETO enviando email:', error);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    // Si es un error de Resend, mostrar más detalles
    if (error.response) {
      console.error('❌ Resend Response Error:', JSON.stringify(error.response.data, null, 2));
    }
    
    throw new Error(`No se pudo enviar el email de verificación: ${error.message}`);
  }
};
