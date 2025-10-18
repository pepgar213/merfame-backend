// src/utils/jwt.js
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config.js';

// Función para generar un token JWT
export const generateToken = (payload) => {
  // Incluir username en el payload del token
  return jwt.sign({
    id: payload.id,
    email: payload.email,
    role: payload.role,
    username: payload.username  // Añadir username al token
  }, JWT_SECRET);
};

export const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { success: true, decoded, error: null }; // Devuelve éxito y el payload decodificado
  } catch (err) {
    // Captura cualquier error que jwt.verify pueda lanzar
    // err.message contendrá un mensaje descriptivo (ej. "invalid signature", "jwt malformed")
    console.error("Error al verificar token:", err.name, ":", err.message); // Agregamos log para depuración
    return { success: false, decoded: null, error: err.message }; // Devuelve fallo y el mensaje de error
  }
};