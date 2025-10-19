// src/utils/config.js
const JWT_SECRET = process.env.JWT_SECRET
const PORT = process.env.PORT;
const BASE_URL = process.env.BASE_URL; // ✅ Nueva línea
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const RESEND_FROM = process.env.RESEND_FROM || 'Merfame <onboarding@resend.dev>';

export {
  JWT_SECRET,
  PORT,
  BASE_URL,
  RESEND_API_KEY,
  RESEND_FROM

};
