// src/workers/songProcessor.js
import Queue from 'bull';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fsp from 'fs/promises';
import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import pkg from 'fft-js';
const { fft, util: fftUtil } = pkg;
import { runPythonScriptAndLog } from '../utils/pythonRunner.js';
import { run } from '../db/queryHelper.js';
import { 
  uploadFile, 
  getTrackFilePath, 
  getPublicUrl,
  deleteTrackFiles 
} from '../services/storageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMP_DIR = join(__dirname, '..', '..', 'temp');
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const execPromise = util.promisify(exec);

// Asegurar que existe el directorio temporal
await fsp.mkdir(TEMP_DIR, { recursive: true });

const redisConfig = process.env.REDIS_URL 
  ? process.env.REDIS_URL 
  : {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    };

export const songQueue = new Queue('song-processing', redisConfig, {
  settings: {
    stalledInterval: 30000,
    maxStalledCount: 1,
    lockDuration: 300000,
    lockRenewTime: 150000,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

// Función para insertar canción en DB
const insertSongIntoDb = async (title, artistId, audioUrl, coverImageUrl, duration, waveformUrl, voiceTimestampsUrl, spotifyId, youtubeId) => {
  try {
    console.log(`[Worker] 💾 Insertando canción en DB...`);
    
    const result = await run(
      `INSERT INTO music_tracks 
       (title, artist_id, audio_url, cover_image_url, duration, waveform_url, voice_timestamps_url, spotify_id, youtube_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, artistId, audioUrl, coverImageUrl, duration, waveformUrl, voiceTimestampsUrl, spotifyId || null, youtubeId || null]
    );
    
    const songId = result.lastID;
    console.log(`[Worker] ✅ Canción insertada con ID: ${songId}`);
    return songId;
  } catch (error) {
    console.error("[Worker] ❌ Error al insertar canción en DB:", error.message);
    throw error;
  }
};

// Función para generar waveform
async function generateWaveform(audioFilePath) {
  const SAMPLE_RATE = 44100;
  const FFT_FRAME_SIZE = 8192;
  const FFT_HOP_SIZE = FFT_FRAME_SIZE / 4;
  const NUM_VISUAL_BINS = 64;
  const GAMMA = 3;
  const MIN_FREQUENCY_HZ = 10;
  const MAX_FREQUENCY_HZ = 14000;
  const VOLUME_SENSITIVITY_EXPONENT = 5;
  const SMOOTHING_WEIGHTS = [0.25, 0.50, 0.25];
  const NOISE_THRESHOLD = 0;

  const fftBinWidthHz = SAMPLE_RATE / FFT_FRAME_SIZE;
  const maxMinusMinFreq = MAX_FREQUENCY_HZ - MIN_FREQUENCY_HZ;
  
  const fftBinToVisualBin = new Array(Math.floor(FFT_FRAME_SIZE/2));
  for (let k = 0; k < fftBinToVisualBin.length; k++) {
    const frequencyOfFftBin = k * fftBinWidthHz;
    if (frequencyOfFftBin < MIN_FREQUENCY_HZ || frequencyOfFftBin >= MAX_FREQUENCY_HZ) {
      fftBinToVisualBin[k] = -1;
      continue;
    }
    const normalizedFrequency = (frequencyOfFftBin - MIN_FREQUENCY_HZ) / maxMinusMinFreq;
    const visualBinFloat = Math.pow(normalizedFrequency, GAMMA) * NUM_VISUAL_BINS;
    fftBinToVisualBin[k] = Math.min(Math.floor(visualBinFloat), NUM_VISUAL_BINS - 1);
  }

  const pcmCommand = `ffmpeg -i "${audioFilePath}" -f s16le -acodec pcm_s16le -ar ${SAMPLE_RATE} -ac 1 -`;

  return new Promise((resolve, reject) => {
    const ffmpegProcess = exec(pcmCommand, { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 });
    
    let pcmData = Buffer.alloc(0);
    
    ffmpegProcess.stdout.on('data', (chunk) => {
      pcmData = Buffer.concat([pcmData, chunk]);
    });

    ffmpegProcess.stderr.on('data', (data) => {
      // FFmpeg escribe info en stderr
    });

    ffmpegProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`FFmpeg exited with code ${code}`));
      }

      try {
        const numSamples = Math.floor(pcmData.length / 2);
        const samples = new Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          samples[i] = pcmData.readInt16LE(i * 2) / 32768.0;
        }

        const frames = [];
        for (let i = 0; i + FFT_FRAME_SIZE <= numSamples; i += FFT_HOP_SIZE) {
          const frame = samples.slice(i, i + FFT_FRAME_SIZE);
          
          for (let j = 0; j < FFT_FRAME_SIZE; j++) {
            const windowValue = 0.5 * (1 - Math.cos((2 * Math.PI * j) / (FFT_FRAME_SIZE - 1)));
            frame[j] *= windowValue;
          }
          
          frames.push(frame);
        }

        // ✅ AQUÍ ESTÁ EL CAMBIO PRINCIPAL
        const waveformData = frames.map((frame, index) => {
          const fftResult = fft(frame);
          const magnitudes = fftUtil.fftMag(fftResult);
          
          const visualBins = new Array(NUM_VISUAL_BINS).fill(0);
          for (let k = 0; k < magnitudes.length; k++) {
            const binIndex = fftBinToVisualBin[k];
            if (binIndex >= 0) {
              visualBins[binIndex] += magnitudes[k];
            }
          }

          const smoothedBins = new Array(NUM_VISUAL_BINS);
          for (let i = 0; i < NUM_VISUAL_BINS; i++) {
            let sum = 0;
            let weightSum = 0;
            for (let j = 0; j < SMOOTHING_WEIGHTS.length; j++) {
              const neighborIndex = i - 1 + j;
              if (neighborIndex >= 0 && neighborIndex < NUM_VISUAL_BINS) {
                sum += visualBins[neighborIndex] * SMOOTHING_WEIGHTS[j];
                weightSum += SMOOTHING_WEIGHTS[j];
              }
            }
            smoothedBins[i] = sum / weightSum;
          }

          const maxBin = Math.max(...smoothedBins);
          const normalizedBins = smoothedBins.map(val => {
            const normalized = val / (maxBin || 1);
            const adjusted = Math.pow(normalized, VOLUME_SENSITIVITY_EXPONENT);
            return adjusted > NOISE_THRESHOLD ? adjusted : 0;
          });

          // ✅ RETORNAR OBJETO CON time Y frequencies
          return {
            time: (index * FFT_HOP_SIZE) / SAMPLE_RATE,
            frequencies: normalizedBins.map(v => Math.round(v * 255))
          };
        });

        resolve(waveformData);
      } catch (err) {
        reject(err);
      }
    });

    ffmpegProcess.on('error', (err) => {
      reject(err);
    });
  });
}

// ==========================================
// PROCESADOR DE TRABAJOS - CON CARPETAS ORGANIZADAS EN R2
// ==========================================
songQueue.process(async (job) => {
  const {
    title,
    artistId,
    duration,
    tempAudioFilePath,
    originalAudioFilename,
    coverImageFilename,
    spotifyId,
    youtubeId
  } = job.data;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`[Worker] 🎵 PROCESANDO JOB ${job.id}`);
  console.log(`[Worker] Título: ${title}`);
  console.log(`[Worker] Artist ID: ${artistId}`);
  console.log(`[Worker] Timestamp: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(80)}`);

  // Generar ID único para este track
  const trackUniqueId = `track-${Date.now()}-${Math.round(Math.random() * 1E9)}`;
  console.log(`[Worker] 🆔 Track Unique ID: ${trackUniqueId}`);
  console.log(`[Worker] 📁 Estructura R2: artists/${artistId}/tracks/${trackUniqueId}/\n`);

  let truncatedAudioFilePath = null;
  let finalAudioFilePath = null;
  let voiceTimestampsFilePath = null;
  let waveformFilePath = null;
  let uploadedFiles = [];

  try {
    await job.progress(10);

    // ============================================
    // FASE 1: TRUNCAR AUDIO A 60 SEGUNDOS
    // ============================================
    console.log('[Worker] 📐 FASE 1: Truncando audio a 60 segundos...');
    const truncatedFilename = `truncated-${Date.now()}.mp3`;
    truncatedAudioFilePath = join(TEMP_DIR, truncatedFilename);

    const truncateCommand = `ffmpeg -i "${tempAudioFilePath}" -t 60 -codec:a copy "${truncatedAudioFilePath}"`;
    console.log(`[Worker] Comando FFmpeg: ${truncateCommand.substring(0, 60)}...`);
    
    const { stderr: truncateStderr } = await execPromise(truncateCommand);
    if (truncateStderr) console.warn(`[Worker] FFmpeg stderr:`, truncateStderr.substring(0, 200));

    // Eliminar el archivo temporal original
    await fsp.unlink(tempAudioFilePath).catch(err => 
      console.error("[Worker] ⚠️  Error al eliminar archivo temporal original:", err.message)
    );

    console.log('[Worker] ✅ Audio truncado correctamente\n');
    await job.progress(30);

    // ============================================
    // FASE 2: DETECCIÓN DE VOZ
    // ============================================
    console.log('[Worker] 🗣️  FASE 2: Detección de voz...');
    const voiceTimestampsFilename = `${path.parse(originalAudioFilename).name}.voice.json`;
    voiceTimestampsFilePath = join(TEMP_DIR, voiceTimestampsFilename);
    
    console.log('[Worker] Ejecutando script Python de detección de voz...');
    await Promise.race([
      runPythonScriptAndLog(truncatedAudioFilePath, voiceTimestampsFilePath),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout en detección de voz (120s)')), 120000)
      )
    ]);
    
    console.log('[Worker] ✅ Detección de voz completada\n');
    await job.progress(45);

    // ============================================
    // FASE 3: COMPRESIÓN FINAL DE AUDIO
    // ============================================
    console.log('[Worker] 🗜️  FASE 3: Compresión final de audio...');
    const compressedAudioFilename = `compressed-${Date.now()}.mp3`;
    finalAudioFilePath = join(TEMP_DIR, compressedAudioFilename);

    const compressCommand = `ffmpeg -i "${truncatedAudioFilePath}" -codec:a libmp3lame -b:a 128k -vn "${finalAudioFilePath}"`;
    console.log(`[Worker] Comprimiendo a 128kbps...`);
    
    const { stderr } = await execPromise(compressCommand);
    if (stderr) console.warn(`[Worker] FFmpeg stderr:`, stderr.substring(0, 200));
    
    // Eliminar el archivo truncado temporal
    await fsp.unlink(truncatedAudioFilePath).catch(err => 
      console.error("[Worker] ⚠️  Error al eliminar audio truncado temporal:", err.message)
    );

    console.log('[Worker] ✅ Audio comprimido correctamente\n');
    await job.progress(60);

    // ============================================
    // FASE 4: GENERACIÓN DE WAVEFORM
    // ============================================
    console.log('[Worker] 📊 FASE 4: Generación de waveform...');
    const waveformFilename = `waveform-${Date.now()}.json`;
    waveformFilePath = join(TEMP_DIR, waveformFilename);
    
    console.log('[Worker] Analizando audio para generar waveform...');
    const waveformData = await generateWaveform(finalAudioFilePath);
    await fsp.writeFile(waveformFilePath, JSON.stringify(waveformData));
    
    console.log(`[Worker] ✅ Waveform generado (${waveformData.length} frames)\n`);
    await job.progress(70);

    // ============================================
    // FASE 5: SUBIR ARCHIVOS A R2 CON ESTRUCTURA DE CARPETAS
    // ============================================
    console.log('[Worker] ☁️  FASE 5: Subiendo archivos a R2...');
    console.log(`[Worker] Estructura: artists/${artistId}/tracks/${trackUniqueId}/\n`);
    
    // 5.1. Subir audio
    console.log(`[Worker] 📤 [1/4] Subiendo audio...`);
    const audioBuffer = await fsp.readFile(finalAudioFilePath);
    const audioPath = getTrackFilePath(artistId, trackUniqueId, 'audio');
    console.log(`[Worker]    Ruta R2: ${audioPath}`);
    const audioUrl = await uploadFile(audioBuffer, audioPath, 'audio/mpeg');
    uploadedFiles.push(audioPath);
    console.log(`[Worker]    ✅ URL: ${audioUrl}\n`);
    
    // 5.2. Subir waveform
    console.log(`[Worker] 📤 [2/4] Subiendo waveform...`);
    const waveformBuffer = await fsp.readFile(waveformFilePath);
    const waveformPath = getTrackFilePath(artistId, trackUniqueId, 'waveform');
    console.log(`[Worker]    Ruta R2: ${waveformPath}`);
    const waveformUrl = await uploadFile(waveformBuffer, waveformPath, 'application/json');
    uploadedFiles.push(waveformPath);
    console.log(`[Worker]    ✅ URL: ${waveformUrl}\n`);
    
    // 5.3. Subir voice timestamps
    console.log(`[Worker] 📤 [3/4] Subiendo timestamps...`);
    const timestampsBuffer = await fsp.readFile(voiceTimestampsFilePath);
    const timestampsPath = getTrackFilePath(artistId, trackUniqueId, 'timestamps');
    console.log(`[Worker]    Ruta R2: ${timestampsPath}`);
    const voiceTimestampsUrl = await uploadFile(timestampsBuffer, timestampsPath, 'application/json');
    uploadedFiles.push(timestampsPath);
    console.log(`[Worker]    ✅ URL: ${voiceTimestampsUrl}\n`);
    
    // 5.4. Subir cover image si existe
    let coverImageUrl = null;
    if (coverImageFilename) {
      console.log(`[Worker] 📤 [4/4] Subiendo cover image...`);
      const localImagePath = join(PUBLIC_DIR, 'images', coverImageFilename);
      
      if (fs.existsSync(localImagePath)) {
        const imageBuffer = await fsp.readFile(localImagePath);
        const imageExt = path.extname(coverImageFilename).substring(1);
        const coverPath = getTrackFilePath(artistId, trackUniqueId, 'cover', imageExt);
        const contentType = imageExt === 'png' ? 'image/png' : 'image/jpeg';
        console.log(`[Worker]    Ruta R2: ${coverPath}`);
        coverImageUrl = await uploadFile(imageBuffer, coverPath, contentType);
        uploadedFiles.push(coverPath);
        console.log(`[Worker]    ✅ URL: ${coverImageUrl}\n`);
        
        // Eliminar imagen local
        await fsp.unlink(localImagePath).catch(err => 
          console.error("[Worker] ⚠️  Error al eliminar imagen local:", err.message)
        );
      } else {
        console.log(`[Worker]    ⚠️  Imagen no encontrada en: ${localImagePath}\n`);
      }
    } else {
      console.log(`[Worker] ⏭️  [4/4] Sin cover image\n`);
    }

    console.log(`[Worker] ✅ Todos los archivos subidos a R2 (${uploadedFiles.length} archivos)\n`);
    await job.progress(85);

    // ============================================
    // FASE 6: LIMPIAR ARCHIVOS TEMPORALES LOCALES
    // ============================================
    console.log('[Worker] 🧹 FASE 6: Limpiando archivos temporales...');
    const cleanupPromises = [
      fsp.unlink(finalAudioFilePath).then(() => console.log('[Worker]    ✅ Audio temporal eliminado')),
      fsp.unlink(waveformFilePath).then(() => console.log('[Worker]    ✅ Waveform temporal eliminado')),
      fsp.unlink(voiceTimestampsFilePath).then(() => console.log('[Worker]    ✅ Timestamps temporal eliminado')),
    ];
    
    await Promise.all(cleanupPromises.map(p => p.catch(err => 
      console.warn('[Worker]    ⚠️  Error en limpieza:', err.message)
    )));
    
    console.log('[Worker] ✅ Limpieza completada\n');

    // ============================================
    // FASE 7: INSERTAR EN BASE DE DATOS
    // ============================================
    console.log('[Worker] 💾 FASE 7: Insertando en base de datos...');
    console.log(`[Worker]    Título: ${title}`);
    console.log(`[Worker]    Artist ID: ${artistId}`);
    console.log(`[Worker]    Duración: 60s`);
    console.log(`[Worker]    Spotify ID: ${spotifyId || 'N/A'}`);
    console.log(`[Worker]    YouTube ID: ${youtubeId || 'N/A'}`);
    
    await insertSongIntoDb(
      title,
      parseInt(artistId, 10),
      audioUrl,
      coverImageUrl,
      60,
      waveformUrl,
      voiceTimestampsUrl,
      spotifyId || null,
      youtubeId || null
    );

    await job.progress(100);
    
    console.log('\n' + '='.repeat(80));
    console.log('[Worker] ✅ ¡CANCIÓN PROCESADA EXITOSAMENTE!');
    console.log(`[Worker] 📁 Ubicación en R2: artists/${artistId}/tracks/${trackUniqueId}/`);
    console.log(`[Worker] 🎵 Título: ${title}`);
    console.log(`[Worker] 🆔 Track ID: ${trackUniqueId}`);
    console.log('='.repeat(80) + '\n');
    
    return { 
      success: true, 
      audioUrl, 
      coverImageUrl, 
      waveformUrl,
      voiceTimestampsUrl,
      trackUniqueId,
      structure: `artists/${artistId}/tracks/${trackUniqueId}/`
    };

  } catch (error) {
    console.error('\n' + '❌'.repeat(40));
    console.error('[Worker] ❌ ERROR PROCESANDO CANCIÓN');
    console.error('[Worker] Job ID:', job.id);
    console.error('[Worker] Error:', error.message);
    console.error('[Worker] Stack:', error.stack);
    console.error('❌'.repeat(40) + '\n');
    
    // ✅ AGREGADO: Verificar si es el último intento
    const isLastAttempt = job.attemptsMade >= job.opts.attempts;
    
    if (isLastAttempt) {
      console.log('[Worker] 🧹 Último intento fallido, limpiando todos los archivos...\n');
      
      // ============================================
      // LIMPIEZA EN CASO DE ERROR - Eliminar de R2
      // ============================================
      if (uploadedFiles.length > 0) {
        console.log(`[Worker] 🧹 Limpiando archivos subidos a R2 (${uploadedFiles.length} archivos)...`);
        try {
          await deleteTrackFiles(artistId, trackUniqueId);
          console.log('[Worker] ✅ Archivos de R2 eliminados\n');
        } catch (cleanupError) {
          console.error('[Worker] ⚠️  Error al limpiar archivos de R2:', cleanupError.message);
        }
      }
      
      // ============================================
      // LIMPIEZA DE ARCHIVOS LOCALES TEMPORALES
      // ============================================
      console.log('[Worker] 🧹 Limpiando archivos temporales locales...');
      const cleanupFiles = [];
      
      if (tempAudioFilePath && fs.existsSync(tempAudioFilePath)) {
        cleanupFiles.push(
          fsp.unlink(tempAudioFilePath)
            .then(() => console.log('[Worker]    ✅ Audio original temporal eliminado'))
            .catch(() => {})
        );
      }
      
      if (truncatedAudioFilePath && fs.existsSync(truncatedAudioFilePath)) {
        cleanupFiles.push(
          fsp.unlink(truncatedAudioFilePath)
            .then(() => console.log('[Worker]    ✅ Audio truncado eliminado'))
            .catch(() => {})
        );
      }
      
      if (finalAudioFilePath && fs.existsSync(finalAudioFilePath)) {
        cleanupFiles.push(
          fsp.unlink(finalAudioFilePath)
            .then(() => console.log('[Worker]    ✅ Audio comprimido eliminado'))
            .catch(() => {})
        );
      }
      
      if (voiceTimestampsFilePath && fs.existsSync(voiceTimestampsFilePath)) {
        cleanupFiles.push(
          fsp.unlink(voiceTimestampsFilePath)
            .then(() => console.log('[Worker]    ✅ Timestamps eliminado'))
            .catch(() => {})
        );
      }
      
      if (waveformFilePath && fs.existsSync(waveformFilePath)) {
        cleanupFiles.push(
          fsp.unlink(waveformFilePath)
            .then(() => console.log('[Worker]    ✅ Waveform eliminado'))
            .catch(() => {})
        );
      }
      
      await Promise.all(cleanupFiles);
      console.log('[Worker] ✅ Limpieza de archivos temporales completada\n');
      
    } else {
      console.log(`[Worker] ⏭️  Intento ${job.attemptsMade}/${job.opts.attempts} fallido, conservando archivos para reintento`);
      console.log('[Worker] 📝 El job será reintentado automáticamente por Bull\n');
    }
    
    throw error;
  }
});

// ==========================================
// EVENT LISTENERS
// ==========================================
songQueue.on('completed', (job, result) => {
  console.log(`\n✅ ========== JOB ${job.id} COMPLETADO ==========`);
  console.log(`   Título: ${job.data.title}`);
  console.log(`   Track ID: ${result.trackUniqueId}`);
  console.log(`   Estructura: ${result.structure}`);
  console.log(`   Audio: ${result.audioUrl}`);
  console.log('='.repeat(50) + '\n');
});

songQueue.on('failed', (job, err) => {
  console.error(`\n❌ ========== JOB ${job.id} FALLÓ ==========`);
  console.error(`   Título: ${job.data.title}`);
  console.error(`   Error: ${err.message}`);
  console.error('='.repeat(50) + '\n');
});

songQueue.on('error', (error) => {
  console.error('❌ Error en la cola de procesamiento:', error.message);
});

songQueue.on('stalled', (job) => {
  console.warn(`⚠️  Job ${job.id} se ha estancado (stalled)`);
});

console.log('\n' + '='.repeat(80));
console.log('⚙️  WORKER DE PROCESAMIENTO DE CANCIONES INICIADO');
console.log('='.repeat(80));
console.log('✅ Escuchando trabajos en la cola "song-processing"...');
console.log('📁 Estructura de almacenamiento: artists/{artist_id}/tracks/{track_id}/');
console.log('☁️  Modo de almacenamiento:', process.env.STORAGE_MODE || 'local');
console.log('='.repeat(80) + '\n');