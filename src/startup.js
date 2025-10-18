// src/startup.js
import dotenv from 'dotenv';
dotenv.config();
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = __dirname; // /BACKEND/src

console.log('🚀 Iniciando sistema Merfame (Servidor + Worker)...\n');

// Verificar que la base de datos existe en src
const dbPath = join(projectRoot, 'database.db');
console.log(`📁 Ruta de BD: ${dbPath}`);

if (fs.existsSync(dbPath)) {
  console.log('✅ Base de datos encontrada\n');
} else {
  console.log('⚠️  Base de datos no encontrada, se creará al iniciar el servidor\n');
}

// Crear variables para almacenar los procesos
let serverProcess;
let workerProcess;
let isShuttingDown = false;

// Función para iniciar el servidor
const startServer = () => {
  return new Promise((resolve) => {
    console.log('📡 Iniciando servidor Fastify...');
    serverProcess = spawn('node', ['server.js'], {
      stdio: 'inherit',
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'development' }
    });

    serverProcess.on('error', (error) => {
      console.error('❌ Error al iniciar servidor:', error.message);
    });

    serverProcess.on('exit', (code) => {
      if (!isShuttingDown) {
        console.error(`❌ Servidor se cerró inesperadamente con código ${code}`);
        shutdown();
      }
    });

    // Dar un pequeño delay para que el servidor inicie antes del worker
    setTimeout(resolve, 2000);
  });
};

// Función para iniciar el worker
const startWorker = () => {
  console.log('⚙️  Iniciando worker de procesamiento...');
  workerProcess = spawn('node', ['worker.js'], {
    stdio: 'inherit',
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'development' }
  });

  workerProcess.on('error', (error) => {
    console.error('❌ Error al iniciar worker:', error.message);
  });

  workerProcess.on('exit', (code) => {
    if (!isShuttingDown) {
      console.error(`❌ Worker se cerró inesperadamente con código ${code}`);
      shutdown();
    }
  });
};

// Función para cerrar gracefully
const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n🛑 Recibida señal de cierre. Deteniendo procesos...');

  if (serverProcess && !serverProcess.killed) {
    console.log('Cerrando servidor...');
    serverProcess.kill('SIGTERM');
  }

  if (workerProcess && !workerProcess.killed) {
    console.log('Cerrando worker...');
    workerProcess.kill('SIGTERM');
  }

  // Dar tiempo para que los procesos se cierren gracefully
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Forzar cierre si aún están activos
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGKILL');
  }

  if (workerProcess && !workerProcess.killed) {
    workerProcess.kill('SIGKILL');
  }

  console.log('✅ Sistema detenido correctamente');
  process.exit(0);
};

// Manejar señales del sistema
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Manejo de excepciones no capturadas
process.on('uncaughtException', (error) => {
  console.error('❌ Excepción no capturada:', error);
  shutdown();
});

// Iniciar ambos procesos
const main = async () => {
  try {
    await startServer();
    startWorker();
    console.log('✅ Sistema completamente iniciado\n');
  } catch (error) {
    console.error('❌ Error al iniciar sistema:', error);
    shutdown();
  }
};

main();