// src/utils/pythonRunner.js
import { promisify } from 'util';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const execPromise = promisify(exec);
const logFilePath = path.join(__dirname, '..', 'log_python.txt');

export async function runPythonScriptAndLog(audioPath, outputPath) {
    const pythonScriptPath = path.join(__dirname, '..', 'scripts', 'voice_finder.py');

    const tfLogLevel = process.env.TF_CPP_MIN_LOG_LEVEL || '2';
    const pythonCmd = process.env.PYTHON_COMMAND || 'python3';
    
    // ✅ CORREGIDO: Usar sintaxis de Linux para variables de entorno
    const pythonCommand = `TF_CPP_MIN_LOG_LEVEL=${tfLogLevel} ${pythonCmd} "${pythonScriptPath}" "${audioPath}" "${outputPath}"`;
    
    console.log(`[Python Runner] Comando a ejecutar: ${pythonCommand}`);

    let stdout = '';
    let stderr = '';

    try {
        // Increase maxBuffer to 10MB (10 * 1024 * 1024)
        const result = await execPromise(pythonCommand, { maxBuffer: 10 * 1024 * 1024 });
        stdout = result.stdout;
        stderr = result.stderr;
        console.log(`[Python Runner] Script finalizado.`);
    } catch (error) {
        console.error(`[Python Runner] Error al ejecutar el script: ${error}`);
        stdout = error.stdout || '';
        stderr = error.stderr || error.message;
    }

    // Escribir el log en el archivo
    const logEntry = `\n--- LOG | ${new Date().toISOString()} ---\n` +
                     `Comando: ${pythonCommand}\n` +
                     `STDOUT:\n${stdout}\n` +
                     `STDERR:\n${stderr}\n`;

    fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) {
            console.error(`[Python Runner] Error al escribir en el archivo de log: ${err}`);
        }
    });

    console.log(`[Python Runner] Output guardado en: ${logFilePath}`);

    // Verificar si hay errores reales (no solo advertencias de TensorFlow)
    if (stderr.includes('Error') || stderr.includes('ModuleNotFoundError')) {
        throw new Error(`El script de Python devolvió un error: ${stderr}`);
    }
    
    return stdout;
}