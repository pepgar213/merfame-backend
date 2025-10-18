import nodemailer from 'nodemailer';
import { BASE_URL } from '../utils/config.js';

// Configuración directa para Porkbun
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verificar conexión (opcional pero recomendado)
transporter.verify(function (error, success) {
  if (error) {
    console.error('Error configurando el transporte SMTP:', error);
  } else {
    console.log('Servidor SMTP configurado correctamente');
  }
});

// Función para enviar email de verificación (sin cambios)
export const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `${BASE_URL}/api/verify-email?token=${token}`; // Ajusta tu URL
  
  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Verifica tu cuenta en Merfame',
    html: `
      <!DOCTYPE html>
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
        .logo {
            max-width: 180px;
            height: auto;
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
        .divider {
            border-top: 1px solid #ddd;
            margin: 25px 0;
        }
        .link {
            color: #FF5000;
            word-break: break-all;
        }
        .social-icons {
            margin-top: 15px;
        }
        .instagram-icon {
            display: inline-block;
            width: 24px;
            height: 24px;
            margin: 0 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <!-- Imagen reemplazando el SVG original -->
            <img src="https://via.placeholder.com/211x64/FF5000/FFFFFF?text=Merfame+Logo" alt="Merfame Logo" class="logo">
        </div>
        
        <div class="content">
            <h1>Bienvenido a Merfame</h1>
            <p>Estás a un paso de comenzar. Por favor verifica tu dirección de email haciendo clic en el siguiente enlace:</p>
            
            <div style="text-align: center;">
                <a href="${verificationUrl}" class="button">Verificar mi email</a>
            </div>
            
            <div class="divider"></div>
            
            <p>Si tienes problemas con el botón, copia y pega la siguiente URL en tu navegador:</p>
            <p><a href="${verificationUrl}" class="link">${verificationUrl}</a></p>
            
            <p>Si no has creado una cuenta en Merfame, por favor ignora este email.</p>
        </div>
        
        <div class="footer">
            <p>© 2025 Merfame. Todos los derechos reservados.</p>
            <p>Este es un mensaje automático, por favor no respondas a este email.</p>
            
            <div class="social-icons">
                <a href="https://www.instagram.com/merfame" target="_blank" class="instagram-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" width="20" height="20">
                        <path fill="#FAFAFA" d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z"/>
                    </svg>
                </a>
            </div>
        </div>
    </div>
</body>
</html>
    `,
};

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email de verificación enviado a: ${email}`);
  } catch (error) {
    console.error('Error enviando email de verificación:', error);
    throw new Error('No se pudo enviar el email de verificación');
  }
};