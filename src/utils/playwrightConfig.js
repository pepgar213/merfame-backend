// src/utils/playwrightConfig.js
import { chromium } from 'playwright';

/**
 * Configuración de navegador con opciones de indetectabilidad
 */
export const getBrowserConfig = () => {
  return {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };
};

/**
 * Configuración de contexto del navegador
 */
export const getContextConfig = () => {
  const userAgent = process.env.USER_AGENT || 
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  return {
    userAgent,
    viewport: { width: 1920, height: 1080 },
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    permissions: [],
    geolocation: undefined,
    colorScheme: 'light',
    deviceScaleFactor: 1,
  };
};

/**
 * Inicializa un navegador con todas las configuraciones
 */
export const initBrowser = async () => {
  const browser = await chromium.launch(getBrowserConfig());
  const context = await browser.newContext(getContextConfig());
  
  // Añadir scripts para ocultar webdriver
  await context.addInitScript(() => {
    // Ocultar webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Ocultar Chrome automation
    window.chrome = {
      runtime: {},
    };
    
    // Modificar plugins para parecer más real
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Modificar languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['es-ES', 'es', 'en'],
    });
  });
  
  return { browser, context };
};

/**
 * Cierra el navegador de forma segura
 */
export const closeBrowser = async (browser) => {
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      console.error('Error cerrando navegador:', error.message);
    }
  }
};

/**
 * Timeout configurable para operaciones de scraping
 */
export const SCRAPING_TIMEOUT = parseInt(process.env.SCRAPING_TIMEOUT || '30000');