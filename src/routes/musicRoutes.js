// src/routes/musicRoutes.js
import fp from 'fastify-plugin';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import fsp from 'fs/promises';
import { query, get } from '../db/queryHelper.js';
import { songQueue } from '../workers/songProcessor.js';
import { BASE_URL } from '../utils/config.js';

// Obtener __dirname para rutas de archivos
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const TEMP_DIR = join(__dirname, '..', '..', 'temp');

// Asegurarse de que los directorios existen
async function ensureDirectories() {
  // Para almacenamiento local (backward compatibility)
  await fsp.mkdir(join(PUBLIC_DIR, 'audio'), { recursive: true });
  await fsp.mkdir(join(PUBLIC_DIR, 'images'), { recursive: true });
  await fsp.mkdir(join(PUBLIC_DIR, 'waveforms'), { recursive: true });
  await fsp.mkdir(join(PUBLIC_DIR, 'timestamps'), { recursive: true });
  
  // Directorio temporal para procesamiento
  await fsp.mkdir(TEMP_DIR, { recursive: true });
}

async function musicRoutes(fastify, options) {
  
  // ==========================================
  // RUTA: Obtener perfil del artista
  // ==========================================
  fastify.get('/artist/profile', {
    preValidation: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      
      // Obtener información del artista
      const artist = await get(
        `SELECT u.id, u.bio, a.name, a.genre, a.image_url, 
                COUNT(ufa.user_id) as followers 
         FROM users u
         JOIN artists a ON u.id = a.user_id
         LEFT JOIN user_follows_artist ufa ON a.id = ufa.artist_id 
         WHERE u.id = ? 
         GROUP BY u.id`,
        [userId]
      );

      if (!artist) {
        return reply.status(404).send({ message: 'Artista no encontrado' });
      }

      // Formatear la respuesta - Las URLs ya vienen completas de R2
      const formattedArtist = {
        id: artist.id,
        name: artist.name,
        genre: artist.genre,
        bio: artist.bio,
        imageUrl: artist.image_url || null, // Ya es URL completa de R2
        followers: artist.followers || 0
      };

      reply.send(formattedArtist);
    } catch (error) {
      console.error('Error obteniendo perfil del artista:', error);
      reply.status(500).send({ error: error.message });
    }
  });

  // ==========================================
  // RUTA: Obtener canciones del artista
  // ==========================================
  fastify.get('/artist/songs', {
    preValidation: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userId = request.user.id;

      // Obtener el artist_id del userId
      const artist = await get(
        `SELECT id FROM artists WHERE user_id = ?`,
        [userId]
      );

      if (!artist) {
        return reply.status(404).send({ message: 'Artista no encontrado' });
      }

      // Obtener las canciones del artista
      const songs = await query(
        `SELECT id, title, audio_url, cover_image_url, duration, waveform_url, voice_timestamps_url
         FROM music_tracks 
         WHERE artist_id = ?
         ORDER BY id DESC`,
        [artist.id]
      );

      // Las URLs ya vienen completas de R2, solo formatear la respuesta
      const formattedSongs = songs.map(song => ({
        id: song.id,
        title: song.title,
        coverImageUrl: song.cover_image_url || null, // URL completa de R2
        audioUrl: song.audio_url || null, // URL completa de R2
        waveformUrl: song.waveform_url || null, // URL completa de R2
        voiceTimestampsUrl: song.voice_timestamps_url || null, // URL completa de R2
        duration: song.duration
      }));

      reply.send(formattedSongs);
    } catch (error) {
      console.error('Error obteniendo canciones del artista:', error);
      reply.status(500).send({ error: error.message });
    }
  });

  // ==========================================
  // RUTA: Subir canción (CON CLOUDFLARE R2)
  // ==========================================
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
            savePath = join(TEMP_DIR, newFilename); // GUARDAR EN TEMP
            originalAudioFilename = newFilename;
            tempAudioFilePath = savePath;
            audioFileFound = true;
            
            console.log(`[${requestId}]    - Guardando como: ${newFilename}`);
            console.log(`[${requestId}]    - Ruta completa: ${savePath}`);
            
            // Guardar archivo temporalmente
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
            console.log(`[${requestId}]    - Verificación: exists=${exists}, size=${stats?.size || 0} bytes`);
            
          } else if (part.fieldname === 'coverImage') {
            // ============ COVER IMAGE - GUARDAR TEMPORALMENTE ============
            timings.imageSaveStart = Date.now();
            console.log(`[${requestId}] 🖼️  Procesando COVER IMAGE`);
            
            if (!part.mimetype || !part.mimetype.startsWith('image/')) {
              console.error(`[${requestId}] ❌ Tipo de imagen rechazado: ${part.mimetype}`);
              await part.file.resume();
              continue; // No es error crítico, continuar sin imagen
            }
            
            const imageExtension = part.filename ? part.filename.split('.').pop() : 'jpg';
            newFilename = `cover-image-${uniqueSuffix}.${imageExtension}`;
            
            // Guardar temporalmente en PUBLIC/images (el worker la subirá a R2)
            savePath = join(PUBLIC_DIR, 'images', newFilename);
            coverImageFilename = newFilename;
            coverImageFound = true;
            
            console.log(`[${requestId}]    - Guardando como: ${newFilename}`);
            console.log(`[${requestId}]    - Ruta completa: ${savePath}`);
            
            const buffer = await part.toBuffer();
            timings.imageSaveEnd = Date.now();
            const bufferTime = timings.imageSaveEnd - timings.imageSaveStart;
            console.log(`[${requestId}]    - Buffer leído: ${buffer.length} bytes en ${bufferTime}ms`);
            
            const writeStart = Date.now();
            await fsp.writeFile(savePath, buffer);
            const writeTime = Date.now() - writeStart;
            console.log(`[${requestId}]    - Archivo escrito en disco en ${writeTime}ms`);
            
            const exists = fs.existsSync(savePath);
            const stats = exists ? await fsp.stat(savePath) : null;
            console.log(`[${requestId}]    - Verificación: exists=${exists}, size=${stats?.size || 0} bytes`);
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

  // ==========================================
  // RUTA: Verificar estado del job
  // ==========================================
  fastify.get('/job-status/:jobId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { jobId } = request.params;
      
      const job = await songQueue.getJob(jobId);
      
      if (!job) {
        return reply.status(404).send({ 
          message: 'Job no encontrado',
          status: 'not_found'
        });
      }

      const state = await job.getState();
      const progress = job.progress();
      const failedReason = job.failedReason;

      reply.send({
        jobId: job.id,
        status: state,
        progress: progress || 0,
        failedReason: failedReason || null,
        data: job.data,
        returnvalue: job.returnvalue
      });
    } catch (error) {
      console.error('Error obteniendo estado del job:', error);
      reply.status(500).send({ error: error.message });
    }
  });

  // ==========================================
  // RUTA: Eliminar canción
  // ==========================================
  fastify.delete('/songs/:songId', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { songId } = request.params;
      const userId = request.user.id;

      // Verificar que la canción existe y pertenece al artista
      const song = await get(
        `SELECT mt.*, a.user_id, mt.audio_url
         FROM music_tracks mt
         JOIN artists a ON mt.artist_id = a.id
         WHERE mt.id = ? AND a.user_id = ?`,
        [songId, userId]
      );

      if (!song) {
        return reply.status(404).send({ 
          message: 'Canción no encontrada o no tienes permisos para eliminarla' 
        });
      }

      // Extraer artistId y trackUniqueId de la URL de audio
      // Formato esperado: https://pub-xxx.r2.dev/artists/{artistId}/tracks/{trackUniqueId}/audio.mp3
      const urlParts = song.audio_url.split('/');
      const artistIdIndex = urlParts.indexOf('artists') + 1;
      const trackIdIndex = urlParts.indexOf('tracks') + 1;
      
      if (artistIdIndex > 0 && trackIdIndex > 0) {
        const artistId = urlParts[artistIdIndex];
        const trackUniqueId = urlParts[trackIdIndex];
        
        console.log(`[Delete] Eliminando archivos de R2: artists/${artistId}/tracks/${trackUniqueId}/`);
        
        // Eliminar todos los archivos de R2
        const { deleteTrackFiles } = await import('../services/storageService.js');
        await deleteTrackFiles(artistId, trackUniqueId);
      }

      // Eliminar de la base de datos
      await run('DELETE FROM music_tracks WHERE id = ?', [songId]);

      console.log(`[Delete] ✅ Canción ${songId} eliminada completamente`);

      reply.send({ 
        message: 'Canción eliminada exitosamente',
        songId: songId
      });
    } catch (error) {
      console.error('Error eliminando canción:', error);
      reply.status(500).send({ error: error.message });
    }
  });
}

export default fp(musicRoutes);