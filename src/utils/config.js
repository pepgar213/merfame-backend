// src/utils/config.js
export const JWT_SECRET = process.env.JWT_SECRET;
export const PORT = process.env.PORT;
export const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const RESEND_FROM = process.env.RESEND_FROM || 'Merfame <onboarding@resend.dev>';
export const DATABASE_URL = process.env.DATABASE_URL;

