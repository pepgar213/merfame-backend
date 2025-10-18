// src/routes/musicRoutes.js
import fp from 'fastify-plugin';
import {
  join,
  dirname
} from 'path';
import {
  fileURLToPath
} from 'url';
import fs from 'fs';
import fsp from 'fs/promises';
import db from '../db/index.js';
import { songQueue } from '../workers/songProcessor.js'; // IMPORTAR LA COLA
import { BASE_URL } from '../utils/config.js';

// Obtener __dirname para rutas de archivos
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const TIMESTAMPS_DIR = join(PUBLIC_DIR, 'timestamps');


// Asegúrate de que los directorios existen
async function ensureDirectories() {
    await fsp.mkdir(join(PUBLIC_DIR, 'audio'), {
        recursive: true
    });
    await fsp.mkdir(join(PUBLIC_DIR, 'images'), {
        recursive: true
    });
    await fsp.mkdir(join(PUBLIC_DIR, 'waveforms'), {
        recursive: true
    });
    await fsp.mkdir(TIMESTAMPS_DIR, {
        recursive: true
    });
}

async function musicRoutes(fastify, options) {
    fastify.get('/artist/profile', {
        preValidation: [fastify.authenticate]
    }, async (request, reply) => {
        try {
            const userId = request.user.id;
            
            // Obtener información del artista desde users
            const artist = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT u.id, u.bio, a.name, a.genre, a.image_url, 
                            COUNT(ufa.user_id) as followers 
                     FROM users u
                     JOIN artists a ON u.id = a.user_id
                     LEFT JOIN user_follows_artist ufa ON a.id = ufa.artist_id 
                     WHERE u.id = ? 
                     GROUP BY u.id`,
                    [userId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (!artist) {
                return reply.status(404).send({ message: 'Artista no encontrado' });
            }

            // Formatear la respuesta
            const formattedArtist = {
                id: artist.id,
                name: artist.name,
                genre: artist.genre,
                bio: artist.bio,
                imageUrl: artist.image_url ? `${BASE_URL}/images/${artist.image_url}` : null,
                followers: artist.followers
            };

            reply.send(formattedArtist);
        } catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });

    fastify.patch('/artist/profile', {
        preValidation: [fastify.authenticate]
    }, async (request, reply) => {
        try {
            const userId = request.user.id;
            const { bio } = request.body;

            // Actualizar la biografía en la tabla users
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE users SET bio = ? WHERE id = ?`,
                    [bio, userId],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            reply.send({ message: 'Biografía actualizada correctamente' });
        } catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });

    fastify.get('/artist/songs', {
        preValidation: [fastify.authenticate]
    }, async (request, reply) => {
        try {
            const userId = request.user.id;
            
            // Primero obtener el artista asociado al usuario
            const artist = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT id FROM artists WHERE user_id = ?`,
                    [userId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (!artist) {
                return reply.status(404).send({ message: 'Artista no encontrado' });
            }

            // Obtener las canciones del artista
            const songs = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT * FROM music_tracks WHERE artist_id = ?`,
                    [artist.id],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });

            // Formatear la respuesta
            const formattedSongs = songs.map(song => ({
                id: song.id,
                title: song.title,
                coverUrl: song.cover_image_url ? `${BASE_URL}${song.cover_image_url}` : null,
                audioUrl: `${BASE_URL}/audio/${song.audio_url}`,
                duration: song.duration
            }));

            reply.send(formattedSongs);
        } catch (error) {
            reply.status(500).send({ error: error.message });
        }
    });

    // RUTA DE UPLOAD CON SISTEMA DE COLAS
    fastify.post('/upload-song', {
    preHandler: [fastify.authenticate]
}, async (request, reply) => {
    await ensureDirectories();

    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${requestId}] 🎵 NUEVA SOLICITUD DE SUBIDA`);
    console.log(`[${requestId}] Timestamp: ${new Date().toISOString()}`);
    console.log(`[${requestId}] User ID: ${request.user.id}`);
    console.log(`${'='.repeat(80)}`);

    const timings = {
        start: Date.now(),
        multipartStart: null,
        multipartEnd: null,
        audioSaveStart: null,
        audioSaveEnd: null,
        imageSaveStart: null,
        imageSaveEnd: null,
        validationStart: null,
        validationEnd: null,
        queueStart: null,
        queueEnd: null,
        responseStart: null,
        responseEnd: null
    };

    let title = null;
    let artist_id = null;
    let duration = null;
    let spotify_id = null;
    let youtube_id = null; 
    let audioFileFound = false;
    let coverImageFound = false;
    let originalAudioFilename = null;
    let coverImageFilename = null;
    let tempAudioFilePath = null;
    let jobEnqueued = false;

    try {
        // ============ FASE 1: PROCESAMIENTO MULTIPART ============
        timings.multipartStart = Date.now();
        console.log(`[${requestId}] 📦 FASE 1: Iniciando procesamiento multipart`);
        console.log(`[${requestId}] Content-Type: ${request.headers['content-type']}`);
        console.log(`[${requestId}] Content-Length: ${request.headers['content-length']} bytes`);
        
        let partCount = 0;
        
        for await (const part of request.parts()) {
            partCount++;
            console.log(`[${requestId}] 📎 Parte ${partCount}: fieldname="${part.fieldname}", type="${part.type}"`);
            
            if (part.file) {
                console.log(`[${requestId}]    - filename: "${part.filename}"`);
                console.log(`[${requestId}]    - mimetype: "${part.mimetype}"`);
                
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                let savePath;
                let newFilename;

                if (part.fieldname === 'audioFile') {
                    // ============ AUDIO FILE ============
                    timings.audioSaveStart = Date.now();
                    console.log(`[${requestId}] 🎵 Procesando AUDIO FILE`);
                    
                    if (!part.mimetype || !part.mimetype.startsWith('audio/')) {
                        console.error(`[${requestId}] ❌ Tipo de audio rechazado: ${part.mimetype}`);
                        await part.file.resume();
                        return reply.code(400).send({
                            message: 'Tipo de archivo de audio no soportado.'
                        });
                    }
                    
                    const fileExtension = part.filename ? part.filename.split('.').pop() : 'mp3';
                    newFilename = `original-audio-${uniqueSuffix}.${fileExtension}`;
                    savePath = join(PUBLIC_DIR, 'audio', newFilename);
                    originalAudioFilename = newFilename;
                    tempAudioFilePath = savePath;
                    audioFileFound = true;
                    
                    console.log(`[${requestId}]    - Guardando como: ${newFilename}`);
                    console.log(`[${requestId}]    - Ruta completa: ${savePath}`);
                    
                    // Guardar archivo
                    const buffer = await part.toBuffer();
                    timings.audioSaveEnd = Date.now();
                    const bufferTime = timings.audioSaveEnd - timings.audioSaveStart;
                    console.log(`[${requestId}]    - Buffer leído: ${buffer.length} bytes en ${bufferTime}ms`);
                    
                    const writeStart = Date.now();
                    await fsp.writeFile(savePath, buffer);
                    const writeTime = Date.now() - writeStart;
                    console.log(`[${requestId}]    - Archivo escrito en disco en ${writeTime}ms`);
                    
                    // Verificar archivo
                    const exists = fs.existsSync(savePath);
                    const stats = exists ? await fsp.stat(savePath) : null;
                    console.log(`[${requestId}]    - ✅ Archivo verificado: existe=${exists}, tamaño=${stats?.size || 0} bytes`);
                    
                    if (!exists || (stats && stats.size === 0)) {
                        console.error(`[${requestId}] ❌ ERROR: Archivo no se guardó correctamente`);
                        throw new Error('El archivo de audio no se guardó correctamente');
                    }
                    
                    const totalAudioTime = Date.now() - timings.audioSaveStart;
                    console.log(`[${requestId}]    - ⏱️  Tiempo total audio: ${totalAudioTime}ms`);
                    
                } else if (part.fieldname === 'coverImage') {
                    // ============ IMAGE FILE ============
                    timings.imageSaveStart = Date.now();
                    console.log(`[${requestId}] 🖼️  Procesando IMAGEN`);
                    
                    if (!part.mimetype || !part.mimetype.startsWith('image/')) {
                        console.error(`[${requestId}] ❌ Tipo de imagen rechazado: ${part.mimetype}`);
                        await part.file.resume();
                        return reply.code(400).send({
                            message: 'Tipo de archivo de imagen no soportado.'
                        });
                    }
                    
                    const fileExtension = part.filename ? part.filename.split('.').pop() : 'jpg';
                    newFilename = `cover-${uniqueSuffix}.${fileExtension}`;
                    savePath = join(PUBLIC_DIR, 'images', newFilename);
                    coverImageFilename = newFilename;
                    coverImageFound = true;
                    
                    console.log(`[${requestId}]    - Guardando como: ${newFilename}`);
                    
                    const buffer = await part.toBuffer();
                    await fsp.writeFile(savePath, buffer);
                    timings.imageSaveEnd = Date.now();
                    const imageTime = timings.imageSaveEnd - timings.imageSaveStart;
                    console.log(`[${requestId}]    - ✅ Imagen guardada: ${buffer.length} bytes en ${imageTime}ms`);
                    
                } else {
                    console.log(`[${requestId}]    - ⏭️  Campo de archivo desconocido, saltando`);
                    await part.file.resume();
                }
            } else {
                // ============ TEXT FIELDS ============
                console.log(`[${requestId}]    - Valor: "${part.value}"`);
                switch (part.fieldname) {
                    case 'title':
                        title = part.value;
                        break;
                    case 'artist_id':
                        artist_id = part.value;
                        break;
                    case 'duration':
                        duration = part.value;
                        break;
                    case 'spotify_id':
                        spotify_id = part.value;
                        break;
                    case 'youtube_id':
                        youtube_id = part.value;
                        break;
                }
            }
        }

        timings.multipartEnd = Date.now();
        const multipartTime = timings.multipartEnd - timings.multipartStart;
        console.log(`[${requestId}] ✅ FASE 1 COMPLETADA: ${partCount} partes procesadas en ${multipartTime}ms`);

        // ============ FASE 2: VALIDACIONES ============
        timings.validationStart = Date.now();
        console.log(`[${requestId}] 🔍 FASE 2: Validando datos`);
        console.log(`[${requestId}]    - title: "${title}"`);
        console.log(`[${requestId}]    - artist_id: "${artist_id}"`);
        console.log(`[${requestId}]    - duration: "${duration}"`);
        console.log(`[${requestId}]    - spotify_id: "${spotify_id}"`);
        console.log(`[${requestId}]    - youtube_id: "${youtube_id}"`);
        console.log(`[${requestId}]    - audioFileFound: ${audioFileFound}`);
        console.log(`[${requestId}]    - coverImageFound: ${coverImageFound}`);

        if (!title || !artist_id || !duration) {
            console.error(`[${requestId}] ❌ VALIDACIÓN FALLIDA: Faltan campos obligatorios`);
            return reply.code(400).send({
                message: 'Faltan campos obligatorios (título, artista, duración).'
            });
        }

        if (!audioFileFound || !originalAudioFilename || !tempAudioFilePath) {
            console.error(`[${requestId}] ❌ VALIDACIÓN FALLIDA: No hay archivo de audio`);
            return reply.code(400).send({
                message: 'No se ha subido ningún archivo de audio.'
            });
        }

        const durationNum = parseInt(duration, 10);
        if (isNaN(durationNum)) {
            console.error(`[${requestId}] ❌ VALIDACIÓN FALLIDA: Duración inválida`);
            return reply.code(400).send({
                message: 'La duración debe ser un número válido.'
            });
        }

        // Verificar existencia del archivo
        if (!fs.existsSync(tempAudioFilePath)) {
            console.error(`[${requestId}] ❌ ERROR CRÍTICO: Archivo no existe: ${tempAudioFilePath}`);
            return reply.code(500).send({
                message: 'Error: archivo de audio no se guardó correctamente.'
            });
        }

        const audioFileStats = await fsp.stat(tempAudioFilePath);
        console.log(`[${requestId}]    - ✅ Archivo verificado en disco: ${audioFileStats.size} bytes`);

        timings.validationEnd = Date.now();
        const validationTime = timings.validationEnd - timings.validationStart;
        console.log(`[${requestId}] ✅ FASE 2 COMPLETADA en ${validationTime}ms`);

        // ============ FASE 3: ENCOLAR TRABAJO ============
        timings.queueStart = Date.now();
        console.log(`[${requestId}] 📋 FASE 3: Encolando trabajo en Bull Queue`);
        
        const jobData = {
            title,
            artistId: artist_id,
            duration: durationNum,
            tempAudioFilePath,
            originalAudioFilename,
            coverImageFilename,
            userId: request.user.id,
            spotifyId: spotify_id,
            youtubeId: youtube_id
        };
        
        console.log(`[${requestId}]    - Datos del job:`, JSON.stringify(jobData, null, 2));
        
        const job = await songQueue.add(jobData, {
            attempts: 2,
            backoff: {
                type: 'exponential',
                delay: 5000
            },
            removeOnComplete: 100,
            removeOnFail: 200
        });

        jobEnqueued = true;
        timings.queueEnd = Date.now();
        const queueTime = timings.queueEnd - timings.queueStart;
        console.log(`[${requestId}] ✅ FASE 3 COMPLETADA: Job ID ${job.id} encolado en ${queueTime}ms`);

        // ============ FASE 4: RESPONDER AL CLIENTE ============
        timings.responseStart = Date.now();
        console.log(`[${requestId}] 📤 FASE 4: Enviando respuesta al cliente`);
        
        const response = {
            message: 'Canción recibida y en proceso de subida.',
            jobId: job.id,
            status: 'processing'
        };
        
        console.log(`[${requestId}]    - Response:`, response);
        
        reply.code(202).send(response);
        
        timings.responseEnd = Date.now();
        const responseTime = timings.responseEnd - timings.responseStart;
        
        // ============ RESUMEN DE TIEMPOS ============
        const totalTime = Date.now() - timings.start;
        console.log(`\n[${requestId}] 📊 RESUMEN DE TIEMPOS:`);
        console.log(`[${requestId}]    ⏱️  Multipart:   ${multipartTime}ms`);
        console.log(`[${requestId}]    ⏱️  Validación:  ${validationTime}ms`);
        console.log(`[${requestId}]    ⏱️  Encolar:     ${queueTime}ms`);
        console.log(`[${requestId}]    ⏱️  Respuesta:   ${responseTime}ms`);
        console.log(`[${requestId}]    ⏱️  TOTAL:       ${totalTime}ms`);
        console.log(`${'='.repeat(80)}\n`);

    } catch (error) {
        const errorTime = Date.now() - timings.start;
        console.error(`\n[${requestId}] ${'❌'.repeat(40)}`);
        console.error(`[${requestId}] ERROR EN UPLOAD (después de ${errorTime}ms)`);
        console.error(`[${requestId}] Mensaje: ${error.message}`);
        console.error(`[${requestId}] Stack:`, error.stack);
        console.error(`[${requestId}] ${'❌'.repeat(40)}\n`);
        
        // LIMPIEZA solo si no se encoló el job
        if (!jobEnqueued) {
            console.log(`[${requestId}] 🧹 Limpiando archivos (job no encolado)...`);
            
            if (tempAudioFilePath && fs.existsSync(tempAudioFilePath)) {
                await fsp.unlink(tempAudioFilePath).catch(err => 
                    console.error(`[${requestId}] Error al eliminar audio temporal:`, err)
                );
            }
            
            if (coverImageFilename) {
                const coverPath = join(PUBLIC_DIR, 'images', coverImageFilename);
                if (fs.existsSync(coverPath)) {
                    await fsp.unlink(coverPath).catch(err => 
                        console.error(`[${requestId}] Error al eliminar imagen:`, err)
                    );
                }
            }
        }

        return reply.code(500).send({
            message: 'Error al iniciar el procesamiento de la canción.',
            error: error.message
        });
    }
});
}

export default fp(musicRoutes);