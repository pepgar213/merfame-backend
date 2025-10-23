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
    console.log(`[Worker] Insertando canción en DB`);
    
    const result = await run(
      `INSERT INTO music_tracks 
       (title, artist_id, audio_url, cover_image_url, duration, waveform_url, voice_timestamps_url, spotify_id, youtube_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, artistId, audioUrl, coverImageUrl, duration, waveformUrl, voiceTimestampsUrl, spotifyId || null, youtubeId || null]
    );
    
    const songId = result.lastID;
    console.log(`✅ Canción insertada con ID: ${songId}`);
    return songId;
  } catch (error) {
    console.error("❌ Error al insertar canción en DB:", error.message);
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

        const waveformData = frames.map(frame => {
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

          return normalizedBins;
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

// PROCESADOR DE TRABAJOS - CON CARPETAS ORGANIZADAS
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
  console.log(`${'='.repeat(80)}`);

  // Generar ID único para este track
  const trackUniqueId = `track-${Date.now()}-${Math.round(Math.random() * 1E9)}`;
  console.log(`[Worker] Track Unique ID: ${trackUniqueId}`);
  console.log(`[Worker] Estructura: artists/${artistId}/tracks/${trackUniqueId}/`);

  let truncatedAudioFilePath = null;
  let finalAudioFilePath = null;
  let voiceTimestampsFilePath = null;
  let waveformFilePath = null;
  let uploadedFiles = [];

  try {
    await job.progress(10);

    // 1. TRUNCAR AUDIO A 60 SEGUNDOS
    console.log('[Worker] Truncando audio a 60 segundos...');
    const truncatedFilename = `truncated-${Date.now()}.mp3`;
    truncatedAudioFilePath = join(TEMP_DIR, truncatedFilename);

    const truncateCommand = `ffmpeg -i "${tempAudioFilePath}" -t 60 -codec:a copy "${truncatedAudioFilePath}"`;
    const { stderr: truncateStderr } = await execPromise(truncateCommand);
    if (truncateStderr) console.warn(`[Worker] FFmpeg stderr:`, truncateStderr);

    // Eliminar el archivo temporal original
    await fsp.unlink(tempAudioFilePath).catch(err => 
      console.error("[Worker] Error al eliminar archivo temporal original:", err)
    );

    await job.progress(30);

    // 2. DETECCIÓN DE VOZ
    const voiceTimestampsFilename = `${path.parse(originalAudioFilename).name}.voice.json`;
    voiceTimestampsFilePath = join(TEMP_DIR, voiceTimestampsFilename);
    
    console.log('[Worker] Iniciando detección de voz...');
    await Promise.race([
      runPythonScriptAndLog(truncatedAudioFilePath, voiceTimestampsFilePath),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout en detección de voz')), 120000)
      )
    ]);
    
    await job.progress(45);

    // 3. COMPRESIÓN FINAL DE AUDIO
    const compressedAudioFilename = `compressed-${Date.now()}.mp3`;
    finalAudioFilePath = join(TEMP_DIR, compressedAudioFilename);

    const compressCommand = `ffmpeg -i "${truncatedAudioFilePath}" -codec:a libmp3lame -b:a 128k -vn "${finalAudioFilePath}"`;
    console.log(`[Worker] Comprimiendo audio final...`);
    
    const { stderr } = await execPromise(compressCommand);
    if (stderr) console.warn(`[Worker] FFmpeg stderr: ${stderr}`);
    
    await job.progress(60);

    // Eliminar el archivo truncado temporal
    await fsp.unlink(truncatedAudioFilePath).catch(err => 
      console.error("[Worker] Error al eliminar audio truncado temporal:", err)
    );

    // 4. GENERACIÓN DE WAVEFORM
    console.log('[Worker] Generando waveform...');
    const waveformFilename = `waveform-${Date.now()}.json`;
    waveformFilePath = join(TEMP_DIR, waveformFilename);
    
    const waveformData = await generateWaveform(finalAudioFilePath);
    await fsp.writeFile(waveformFilePath, JSON.stringify(waveformData));
    
    await job.progress(70);

    // 5. SUBIR ARCHIVOS A R2 CON ESTRUCTURA DE CARPETAS
    console.log('[Worker] 📁 Subiendo archivos con estructura organizada...');
    
    // Subir audio
    console.log(`[Worker] Subiendo audio...`);
    const audioBuffer = await fsp.readFile(finalAudioFilePath);
    const audioPath = getTrackFilePath(artistId, trackUniqueId, 'audio');
    const audioUrl = await uploadFile(audioBuffer, audioPath, 'audio/mpeg');
    uploadedFiles.push(audioPath);
    console.log(`[Worker] ✅ Audio: ${audioUrl}`);
    
    // Subir waveform
    console.log(`[Worker] Subiendo waveform...`);
    const waveformBuffer = await fsp.readFile(waveformFilePath);
    const waveformPath = getTrackFilePath(artistId, trackUniqueId, 'waveform');
    const waveformUrl = await uploadFile(waveformBuffer, waveformPath, 'application/json');
    uploadedFiles.push(waveformPath);
    console.log(`[Worker] ✅ Waveform: ${waveformUrl}`);
    
    // Subir voice timestamps
    console.log(`[Worker] Subiendo timestamps...`);
    const timestampsBuffer = await fsp.readFile(voiceTimestampsFilePath);
    const timestampsPath = getTrackFilePath(artistId, trackUniqueId, 'timestamps');
    const voiceTimestampsUrl = await uploadFile(timestampsBuffer, timestampsPath, 'application/json');
    uploadedFiles.push(timestampsPath);
    console.log(`[Worker] ✅ Timestamps: ${voiceTimestampsUrl}`);
    
    // Subir cover image si existe
    let coverImageUrl = null;
    if (coverImageFilename) {
      console.log(`[Worker] Subiendo cover image...`);
      const localImagePath = join(__dirname, '..', '..', 'public', 'images', coverImageFilename);
      if (fs.existsSync(localImagePath)) {
        const imageBuffer = await fsp.readFile(localImagePath);
        const imageExt = path.extname(coverImageFilename).substring(1);
        const coverPath = getTrackFilePath(artistId, trackUniqueId, 'cover', imageExt);
        const contentType = imageExt === 'png' ? 'image/png' : 'image/jpeg';
        coverImageUrl = await uploadFile(imageBuffer, coverPath, contentType);
        uploadedFiles.push(coverPath);
        console.log(`[Worker] ✅ Cover: ${coverImageUrl}`);
        
        // Eliminar imagen local
        await fsp.unlink(localImagePath).catch(err => 
          console.error("[Worker] Error al eliminar imagen local:", err)
        );
      }
    }

    await job.progress(85);

    // 6. LIMPIAR ARCHIVOS TEMPORALES LOCALES
    console.log('[Worker] 🧹 Limpiando archivos temporales...');
    const cleanupPromises = [
      fsp.unlink(finalAudioFilePath),
      fsp.unlink(waveformFilePath),
      fsp.unlink(voiceTimestampsFilePath),
    ];
    
    await Promise.all(cleanupPromises.map(p => p.catch(err => console.warn('[Worker] Error en limpieza:', err))));

    // 7. INSERTAR EN BASE DE DATOS
    console.log(`[Worker] 💾 Insertando en DB...`);
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
    
    console.log('[Worker] ✅ Canción procesada exitosamente');
    console.log(`[Worker] 📁 Ubicación en R2: artists/${artistId}/tracks/${trackUniqueId}/`);
    
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
    console.error('[Worker] ❌ Error procesando canción:', error);
    
    // LIMPIEZA EN CASO DE ERROR - Eliminar de R2
    if (uploadedFiles.length > 0) {
      console.log(`[Worker] 🧹 Limpiando archivos subidos a R2 (${uploadedFiles.length} archivos)...`);
      try {
        await deleteTrackFiles(artistId, trackUniqueId);
        console.log('[Worker] ✅ Archivos de R2 eliminados');
      } catch (cleanupError) {
        console.error('[Worker] ⚠️ Error al limpiar archivos de R2:', cleanupError);
      }
    }
    
    // LIMPIEZA DE ARCHIVOS LOCALES TEMPORALES
    const cleanupFiles = [];
    
    if (tempAudioFilePath && fs.existsSync(tempAudioFilePath)) {
      cleanupFiles.push(fsp.unlink(tempAudioFilePath));
    }
    
    if (truncatedAudioFilePath && fs.existsSync(truncatedAudioFilePath)) {
      cleanupFiles.push(fsp.unlink(truncatedAudioFilePath));
    }
    
    if (finalAudioFilePath && fs.existsSync(finalAudioFilePath)) {
      cleanupFiles.push(fsp.unlink(finalAudioFilePath));
    }
    
    if (voiceTimestampsFilePath && fs.existsSync(voiceTimestampsFilePath)) {
      cleanupFiles.push(fsp.unlink(voiceTimestampsFilePath));
    }
    
    if (waveformFilePath && fs.existsSync(waveformFilePath)) {
      cleanupFiles.push(fsp.unlink(waveformFilePath));
    }
    
    await Promise.all(cleanupFiles.map(p => p.catch(() => {})));
    
    throw error;
  }
});

// Event listeners
songQueue.on('completed', (job, result) => {
  console.log(`✅ Job ${job.id} completado`);
  console.log(`   📁 Estructura: ${result.structure}`);
});

songQueue.on('failed', (job, err) => {
  console.error(`❌ Job ${job.id} falló:`, err.message);
});

songQueue.on('error', (error) => {
  console.error('❌ Error en la cola:', error);
});

console.log('⚙️  Worker iniciado y escuchando trabajos...');