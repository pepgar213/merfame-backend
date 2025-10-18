// src/utils/config.js
const JWT_SECRET = process.env.JWT_SECRET
const PORT = process.env.PORT;
const BASE_URL = process.env.BASE_URL; // ✅ Nueva línea

export {
  JWT_SECRET,
  PORT,
  BASE_URL
};