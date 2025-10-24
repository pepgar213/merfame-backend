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

// ============================================
// ✅ FUNCIÓN GENERATEWAVEFORM CORREGIDA
// ============================================
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
  
  // ✅ ALGORITMO CORRECTO: Pre-calcular mapeo de bins FFT a bins visuales
  const fftBinToVisualBin = new Array(Math.floor(FFT_FRAME_SIZE/2));
  for (let k = 0; k < fftBinToVisualBin.length; k++) {
    const frequencyOfFftBin = k * fftBinWidthHz;
    if (frequencyOfFftBin >= MIN_FREQUENCY_HZ && frequencyOfFftBin <= MAX_FREQUENCY_HZ) {
      const normalizedFreq = (frequencyOfFftBin - MIN_FREQUENCY_HZ) / maxMinusMinFreq;
      // ✅ CORRECCIÓN CRÍTICA: 1/GAMMA en lugar de GAMMA
      const gammaCorrectedNormalizedFreq = Math.pow(normalizedFreq, 1 / GAMMA);
      let binIndex = Math.floor(gammaCorrectedNormalizedFreq * NUM_VISUAL_BINS);
      if (binIndex < 0) binIndex = 0;
      if (binIndex >= NUM_VISUAL_BINS) binIndex = NUM_VISUAL_BINS - 1;
      fftBinToVisualBin[k] = binIndex;
    } else {
      fftBinToVisualBin[k] = -1;
    }
  }

  // ✅ Extraer PCM usando FFmpeg
  const ffmpegCommand = `ffmpeg -i "${audioFilePath}" -ac 1 -ar ${SAMPLE_RATE} -f s16le -c:a pcm_s16le -map 0:a -`;
  const result = await execPromise(ffmpegCommand, {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 50
  });

  const audioBufferStdout = result.stdout;
  const audioSamples = [];

  // Convertir buffer a samples
  for (let i = 0; i < audioBufferStdout.length; i += 2) {
    audioSamples.push(audioBufferStdout.readInt16LE(i));
  }

  const waveformData = [];

  // ✅ Procesar frames con el algoritmo correcto
  for (let i = 0; i < audioSamples.length - FFT_FRAME_SIZE; i += FFT_HOP_SIZE) {
    const frame = audioSamples.slice(i, i + FFT_FRAME_SIZE);
    const complexResult = fft(frame);
    const magnitudes = fftUtil.fftMag(complexResult);

    // Acumular magnitudes en bins visuales
    const binnedFrequencies = new Array(NUM_VISUAL_BINS).fill(0);

    for (let k = 0; k < magnitudes.length / 2; k++) {
      const visualBinIndex = fftBinToVisualBin[k];
      if (visualBinIndex !== -1) {
        const magnitude = magnitudes[k];
        if (magnitude >= NOISE_THRESHOLD) {
          binnedFrequencies[visualBinIndex] += magnitude;
        }
      }
    }

    // ✅ Aplicar smoothing con pesos
    const smoothedBinnedFrequencies = new Array(NUM_VISUAL_BINS).fill(0);
    for (let binIndex = 0; binIndex < NUM_VISUAL_BINS; binIndex++) {
      let smoothedValue = 0;
      let totalWeight = 0;
      for (let w = 0; w < SMOOTHING_WEIGHTS.length; w++) {
        const neighborOffset = w - 1;
        const neighborIndex = binIndex + neighborOffset;
        if (neighborIndex >= 0 && neighborIndex < NUM_VISUAL_BINS) {
          smoothedValue += binnedFrequencies[neighborIndex] * SMOOTHING_WEIGHTS[w];
          totalWeight += SMOOTHING_WEIGHTS[w];
        }
      }
      smoothedBinnedFrequencies[binIndex] = totalWeight > 0 ? smoothedValue / totalWeight : 0;
    }

    // ✅ Normalización logarítmica con sensibilidad de volumen
    let maxMagnitude = 0;
    for (let j = 0; j < smoothedBinnedFrequencies.length; j++) {
      if (smoothedBinnedFrequencies[j] > maxMagnitude) {
        maxMagnitude = smoothedBinnedFrequencies[j];
      }
    }

    const normalizedBinnedFrequencies = new Array(NUM_VISUAL_BINS);
    const logMax = Math.log(maxMagnitude + 1);
    
    for (let j = 0; j < smoothedBinnedFrequencies.length; j++) {
      const val = smoothedBinnedFrequencies[j];
      let scaledLogValue = 0;
      
      if (maxMagnitude > 0) {
        const logVal = Math.log(val + 1);
        scaledLogValue = logVal / logMax;
      }

      const dynamicValue = Math.pow(scaledLogValue, VOLUME_SENSITIVITY_EXPONENT);
      normalizedBinnedFrequencies[j] = Math.min(255, Math.round(dynamicValue * 255));
    }

    // ✅ Formato correcto: objeto con time y frequencies
    waveformData.push({
      time: (i / SAMPLE_RATE),
      frequencies: normalizedBinnedFrequencies
    });
  }

  return waveformData;
}

// ==========================================
// PROCESADOR DE TRABAJOS
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
  console.log(`[Worker] 📁 Estructura: artists/${artistId}/tracks/${trackUniqueId}/\n`);

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
    console.log(`[Worker] Input: ${tempAudioFilePath}`);
    
    const truncatedFilename = `truncated-${Date.now()}.mp3`;
    truncatedAudioFilePath = join(TEMP_DIR, truncatedFilename);
    
    const truncateCommand = `ffmpeg -i "${tempAudioFilePath}" -t 60 -af "afade=t=out:st=55:d=5" -codec:a libmp3lame -b:a 192k -vn "${truncatedAudioFilePath}"`;
    const { stderr: truncateStderr } = await execPromise(truncateCommand);
    if (truncateStderr) console.warn(`[Worker] FFmpeg stderr:`, truncateStderr.substring(0, 200));
    
    await fsp.unlink(tempAudioFilePath).catch(err => 
      console.error("[Worker] ⚠️  Error al eliminar audio original:", err.message)
    );
    
    console.log('[Worker] ✅ Audio truncado a 60s con fadeout\n');
    await job.progress(25);

    // ============================================
    // FASE 2: DETECCIÓN DE VOZ
    // ============================================
    console.log('[Worker] 🎤 FASE 2: Detección de voz con Python...');
    const timestampsFilename = `timestamps-${Date.now()}.json`;
    voiceTimestampsFilePath = join(TEMP_DIR, timestampsFilename);
    
    await Promise.race([
      runPythonScriptAndLog(truncatedAudioFilePath, voiceTimestampsFilePath),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout en detección de voz')), 120000)
      )
    ]);
    
    console.log('[Worker] ✅ Timestamps de voz generados\n');
    await job.progress(45);

    // ============================================
    // FASE 3: COMPRESIÓN FINAL
    // ============================================
    console.log('[Worker] 🗜️  FASE 3: Compresión final a 128kbps...');
    const compressedAudioFilename = `compressed-${Date.now()}.mp3`;
    finalAudioFilePath = join(TEMP_DIR, compressedAudioFilename);

    const compressCommand = `ffmpeg -i "${truncatedAudioFilePath}" -codec:a libmp3lame -b:a 128k -vn "${finalAudioFilePath}"`;
    const { stderr } = await execPromise(compressCommand);
    if (stderr) console.warn(`[Worker] FFmpeg stderr:`, stderr.substring(0, 200));
    
    await fsp.unlink(truncatedAudioFilePath).catch(err => 
      console.error("[Worker] ⚠️  Error al eliminar audio truncado:", err.message)
    );

    console.log('[Worker] ✅ Audio comprimido correctamente\n');
    await job.progress(60);

    // ============================================
    // FASE 4: GENERACIÓN DE WAVEFORM
    // ============================================
    console.log('[Worker] 📊 FASE 4: Generación de waveform...');
    const waveformFilename = `waveform-${Date.now()}.json`;
    waveformFilePath = join(TEMP_DIR, waveformFilename);
    
    console.log('[Worker] Analizando audio con algoritmo corregido...');
    const waveformData = await generateWaveform(finalAudioFilePath);
    await fsp.writeFile(waveformFilePath, JSON.stringify(waveformData));
    
    console.log(`[Worker] ✅ Waveform generado (${waveformData.length} frames)\n`);
    await job.progress(70);

    // ============================================
    // FASE 5: SUBIR ARCHIVOS A ALMACENAMIENTO
    // ============================================
    console.log('[Worker] ☁️  FASE 5: Subiendo archivos...');
    console.log(`[Worker] Estructura: artists/${artistId}/tracks/${trackUniqueId}/\n`);
    
    // 5.1. Subir audio
    console.log(`[Worker] 📤 [1/4] Subiendo audio...`);
    const audioBuffer = await fsp.readFile(finalAudioFilePath);
    const audioPath = getTrackFilePath(artistId, trackUniqueId, 'audio');
    console.log(`[Worker]    Ruta: ${audioPath}`);
    const audioUrl = await uploadFile(audioBuffer, audioPath, 'audio/mpeg');
    uploadedFiles.push(audioPath);
    console.log(`[Worker]    ✅ URL: ${audioUrl}\n`);
    
    // 5.2. Subir waveform
    console.log(`[Worker] 📤 [2/4] Subiendo waveform...`);
    const waveformBuffer = await fsp.readFile(waveformFilePath);
    const waveformPath = getTrackFilePath(artistId, trackUniqueId, 'waveform');
    console.log(`[Worker]    Ruta: ${waveformPath}`);
    const waveformUrl = await uploadFile(waveformBuffer, waveformPath, 'application/json');
    uploadedFiles.push(waveformPath);
    console.log(`[Worker]    ✅ URL: ${waveformUrl}\n`);
    
    // 5.3. Subir timestamps
    console.log(`[Worker] 📤 [3/4] Subiendo timestamps...`);
    const timestampsBuffer = await fsp.readFile(voiceTimestampsFilePath);
    const timestampsPath = getTrackFilePath(artistId, trackUniqueId, 'timestamps');
    console.log(`[Worker]    Ruta: ${timestampsPath}`);
    const voiceTimestampsUrl = await uploadFile(timestampsBuffer, timestampsPath, 'application/json');
    uploadedFiles.push(timestampsPath);
    console.log(`[Worker]    ✅ URL: ${voiceTimestampsUrl}\n`);
    
    // 5.4. Subir cover si existe
    let coverImageUrl = null;
    if (coverImageFilename) {
      console.log(`[Worker] 📤 [4/4] Subiendo cover image...`);
      const localImagePath = join(PUBLIC_DIR, 'images', coverImageFilename);
      
      if (fs.existsSync(localImagePath)) {
        const imageBuffer = await fsp.readFile(localImagePath);
        const imageExt = path.extname(coverImageFilename).substring(1);
        const coverPath = getTrackFilePath(artistId, trackUniqueId, 'cover', imageExt);
        const contentType = imageExt === 'png' ? 'image/png' : 'image/jpeg';
        console.log(`[Worker]    Ruta: ${coverPath}`);
        coverImageUrl = await uploadFile(imageBuffer, coverPath, contentType);
        uploadedFiles.push(coverPath);
        console.log(`[Worker]    ✅ URL: ${coverImageUrl}\n`);
        
        await fsp.unlink(localImagePath).catch(err => 
          console.error("[Worker] ⚠️  Error al eliminar cover local:", err.message)
        );
      } else {
        console.log('[Worker]    ⚠️  Cover no encontrado localmente\n');
      }
    }

    await job.progress(85);

    // ============================================
    // FASE 6: INSERTAR EN BASE DE DATOS
    // ============================================
    console.log('[Worker] 💾 FASE 6: Guardando en base de datos...');
    await insertSongIntoDb(
      title,
      parseInt(artistId, 10),
      audioUrl,
      coverImageUrl,
      60, // Duración fija
      waveformUrl,
      voiceTimestampsUrl,
      spotifyId || null,
      youtubeId || null
    );

    await job.progress(95);

    // ============================================
    // FASE 7: LIMPIEZA DE ARCHIVOS TEMPORALES
    // ============================================
    console.log('[Worker] 🧹 FASE 7: Limpiando archivos temporales...');
    const cleanupFiles = [];
    
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
    console.log('[Worker] ✅ Limpieza completada\n');

    await job.progress(100);

    // ============================================
    // RESULTADO FINAL
    // ============================================
    const result = {
      success: true,
      trackUniqueId,
      audioUrl,
      coverImageUrl,
      waveformUrl,
      voiceTimestampsUrl,
      structure: `artists/${artistId}/tracks/${trackUniqueId}/`
    };

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[Worker] ✅ JOB ${job.id} COMPLETADO EXITOSAMENTE`);
    console.log(`[Worker] Track ID: ${trackUniqueId}`);
    console.log(`${'='.repeat(80)}\n`);

    return result;

  } catch (error) {
    console.error(`\n${'='.repeat(80)}`);
    console.error(`[Worker] ❌ ERROR EN JOB ${job.id}`);
    console.error(`[Worker] Error: ${error.message}`);
    console.error(`${'='.repeat(80)}\n`);
    
    // Limpieza en caso de error
    if (job.attemptsMade >= job.opts.attempts) {
      console.log('[Worker] 🗑️  Último intento fallido - limpiando archivos subidos...');
      
      if (uploadedFiles.length > 0) {
        try {
          await deleteTrackFiles(uploadedFiles);
          console.log('[Worker] ✅ Archivos subidos eliminados del almacenamiento');
        } catch (cleanupError) {
          console.error('[Worker] ⚠️  Error al limpiar archivos:', cleanupError.message);
        }
      }

      console.log('[Worker] 🧹 Limpiando archivos temporales locales...');
      const cleanupFiles = [];
      
      if (tempAudioFilePath && fs.existsSync(tempAudioFilePath)) {
        cleanupFiles.push(fsp.unlink(tempAudioFilePath).catch(() => {}));
      }
      
      if (truncatedAudioFilePath && fs.existsSync(truncatedAudioFilePath)) {
        cleanupFiles.push(fsp.unlink(truncatedAudioFilePath).catch(() => {}));
      }
      
      if (finalAudioFilePath && fs.existsSync(finalAudioFilePath)) {
        cleanupFiles.push(fsp.unlink(finalAudioFilePath).catch(() => {}));
      }
      
      if (voiceTimestampsFilePath && fs.existsSync(voiceTimestampsFilePath)) {
        cleanupFiles.push(fsp.unlink(voiceTimestampsFilePath).catch(() => {}));
      }
      
      if (waveformFilePath && fs.existsSync(waveformFilePath)) {
        cleanupFiles.push(fsp.unlink(waveformFilePath).catch(() => {}));
      }
      
      await Promise.all(cleanupFiles);
      console.log('[Worker] ✅ Limpieza completada\n');
      
    } else {
      console.log(`[Worker] ⏭️  Intento ${job.attemptsMade}/${job.opts.attempts} fallido`);
      console.log('[Worker] 📝 El job será reintentado automáticamente\n');
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
  console.error('❌ Error en la cola:', error.message);
});

songQueue.on('stalled', (job) => {
  console.warn(`⚠️  Job ${job.id} se ha estancado (stalled)`);
});

console.log('\n' + '='.repeat(80));
console.log('⚙️  WORKER DE PROCESAMIENTO DE CANCIONES INICIADO');
console.log('='.repeat(80));
console.log('✅ Escuchando trabajos en la cola "song-processing"...');
console.log('📁 Estructura: artists/{artist_id}/tracks/{track_id}/');
console.log('☁️  Almacenamiento:', process.env.STORAGE_MODE || 'local');
console.log('='.repeat(80) + '\n');