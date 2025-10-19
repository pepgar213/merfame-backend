// src/workers/songProcessor.js
import Queue from 'bull';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fsp from 'fs/promises';
import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';
import db from '../db/index.js';
import pkg from 'fft-js';
const { fft, util: fftUtil } = pkg;
import { runPythonScriptAndLog } from '../utils/pythonRunner.js';
import path from 'path';
import { run } from '../db/queryHelper.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const execPromise = util.promisify(exec);

// Crear la cola de trabajos
export const songQueue = new Queue('song-processing', {
  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
  },
  settings: {
    stalledInterval: 30000,
    maxStalledCount: 1,
    lockDuration: 300000,
    lockRenewTime: 150000,
  },
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
  }
});

// Función para insertar canción en DB - CORREGIDA
const insertSongIntoDb = async (title, artistId, audioUrl, coverImageUrl, duration, waveformUrl, voiceTimestampsUrl, spotifyId, youtubeId) => {
  try {
    console.log(`[Worker] Insertando canción en DB con spotify_id: ${spotifyId}, youtube_id: ${youtubeId}`);
    
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
    if (frequencyOfFftBin >= MIN_FREQUENCY_HZ && frequencyOfFftBin <= MAX_FREQUENCY_HZ) {
      const normalizedFreq = (frequencyOfFftBin - MIN_FREQUENCY_HZ) / maxMinusMinFreq;
      const gammaCorrectedNormalizedFreq = Math.pow(normalizedFreq, 1 / GAMMA);
      let binIndex = Math.floor(gammaCorrectedNormalizedFreq * NUM_VISUAL_BINS);
      if (binIndex < 0) binIndex = 0;
      if (binIndex >= NUM_VISUAL_BINS) binIndex = NUM_VISUAL_BINS - 1;
      fftBinToVisualBin[k] = binIndex;
    } else {
      fftBinToVisualBin[k] = -1;
    }
  }

  const ffmpegCommand = `ffmpeg -i "${audioFilePath}" -ac 1 -ar ${SAMPLE_RATE} -f s16le -c:a pcm_s16le -map 0:a -`;
  const result = await execPromise(ffmpegCommand, {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 50
  });

  const audioBufferStdout = result.stdout;
  const audioSamples = [];

  for (let i = 0; i < audioBufferStdout.length; i += 2) {
    audioSamples.push(audioBufferStdout.readInt16LE(i));
  }

  const waveformData = [];

  for (let i = 0; i < audioSamples.length - FFT_FRAME_SIZE; i += FFT_HOP_SIZE) {
    const frame = audioSamples.slice(i, i + FFT_FRAME_SIZE);
    const complexResult = fft(frame);
    const magnitudes = fftUtil.fftMag(complexResult);

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

    waveformData.push({
      time: (i / SAMPLE_RATE),
      frequencies: normalizedBinnedFrequencies
    });
  }

  return waveformData;
}

// EXPORTAR el procesador como función
export const processSong = async (job) => {
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

  let compressedAudioFilename = null;
  let voiceTimestampsFilePath = null;
  let finalAudioFilePath = null;
  let truncatedAudioFilePath = null;

  try {
    await job.progress(10);

    console.log(`[Worker] Verificando archivo: ${tempAudioFilePath}`);
    if (!fs.existsSync(tempAudioFilePath)) {
      throw new Error(`Archivo de audio no encontrado: ${tempAudioFilePath}`);
    }
    
    const fileStats = await fsp.stat(tempAudioFilePath);
    console.log(`[Worker] Archivo encontrado, tamaño: ${fileStats.size} bytes`);

    // 1. TRUNCAR Y APLICAR FADEOUT (LO PRIMERO)
    console.log('[Worker] Truncando audio a 1 minuto y aplicando fadeout de 5 segundos...');
    const truncatedAudioFilename = `truncated-${Date.now()}-${Math.round(Math.random() * 1E9)}.mp3`;
    truncatedAudioFilePath = join(PUBLIC_DIR, 'audio', truncatedAudioFilename);
    
    // Truncar a 60 segundos y aplicar fadeout de 5 segundos desde el segundo 55
    const truncateCommand = `ffmpeg -i "${tempAudioFilePath}" -t 60 -af "afade=t=out:st=55:d=5" -codec:a libmp3lame -b:a 192k -vn "${truncatedAudioFilePath}"`;
    const { stderr: truncateStderr } = await execPromise(truncateCommand);
    if (truncateStderr) console.warn(`[Worker] FFmpeg truncate stderr: ${truncateStderr}`);
    
    // Eliminar el archivo original temporal
    await fsp.unlink(tempAudioFilePath).catch(err => 
      console.error("[Worker] Error al eliminar audio temporal original:", err)
    );
    
    await job.progress(25);

    // 2. DETECCIÓN DE VOZ (usando el audio truncado)
    const voiceTimestampsFilename = `${path.parse(originalAudioFilename).name}.voice.json`;
    voiceTimestampsFilePath = join(PUBLIC_DIR, 'timestamps', voiceTimestampsFilename);
    
    console.log('[Worker] Iniciando detección de voz...');
    await Promise.race([
      runPythonScriptAndLog(truncatedAudioFilePath, voiceTimestampsFilePath),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout en detección de voz')), 120000)
      )
    ]);
    
    await job.progress(45);

    // 3. COMPRESIÓN FINAL DE AUDIO
    compressedAudioFilename = `audio-${Date.now()}-${Math.round(Math.random() * 1E9)}.mp3`;
    finalAudioFilePath = join(PUBLIC_DIR, 'audio', compressedAudioFilename);

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
    const waveformFileName = `${compressedAudioFilename}.json`;
    const waveformFilePath = join(PUBLIC_DIR, 'waveforms', waveformFileName);
    
    const waveformData = await generateWaveform(finalAudioFilePath);
    await fsp.writeFile(waveformFilePath, JSON.stringify(waveformData));
    
    await job.progress(80);

    // 5. INSERTAR EN BASE DE DATOS - Siempre con duración de 60 segundos
    const audioUrl = `/audio/${compressedAudioFilename}`;
    const coverImageUrl = coverImageFilename ? `/images/${coverImageFilename}` : null;
    const waveformUrl = `/waveforms/${waveformFileName}`;
    const voiceTimestampsUrl = `/timestamps/${voiceTimestampsFilename}`;

    console.log(`[Worker] Insertando en DB con spotify_id: ${spotifyId}, youtube_id: ${youtubeId}`);

    await insertSongIntoDb(
      title,
      parseInt(artistId, 10),
      audioUrl,
      coverImageUrl,
      60, // Duración fija de 60 segundos
      waveformUrl,
      voiceTimestampsUrl,
      spotifyId || null,
      youtubeId || null
    );

    await job.progress(100);

    console.log('[Worker] Canción procesada exitosamente');
    
    return { 
      success: true, 
      audioUrl, 
      coverImageUrl, 
      waveformUrl,
      voiceTimestampsUrl 
    };

  } catch (error) {
    console.error('[Worker] Error procesando canción:', error);
    
    // LIMPIEZA EN CASO DE ERROR
    const cleanupFiles = [];
    
    if (tempAudioFilePath && fs.existsSync(tempAudioFilePath)) {
      cleanupFiles.push(
        fsp.unlink(tempAudioFilePath)
          .then(() => console.log(`[Worker] Limpieza: archivo temporal eliminado`))
          .catch(err => console.error(`[Worker] Error al eliminar audio temporal: ${err}`))
      );
    }
    
    if (truncatedAudioFilePath && fs.existsSync(truncatedAudioFilePath)) {
      cleanupFiles.push(
        fsp.unlink(truncatedAudioFilePath)
          .then(() => console.log(`[Worker] Limpieza: audio truncado eliminado`))
          .catch(err => console.error(`[Worker] Error al eliminar audio truncado: ${err}`))
      );
    }
    
    if (finalAudioFilePath && fs.existsSync(finalAudioFilePath)) {
      cleanupFiles.push(
        fsp.unlink(finalAudioFilePath)
          .then(() => console.log(`[Worker] Limpieza: audio comprimido eliminado`))
          .catch(err => console.error(`[Worker] Error al eliminar audio comprimido: ${err}`))
      );
    }
    
    if (voiceTimestampsFilePath && fs.existsSync(voiceTimestampsFilePath)) {
      cleanupFiles.push(
        fsp.unlink(voiceTimestampsFilePath)
          .then(() => console.log(`[Worker] Limpieza: timestamps eliminados`))
          .catch(err => console.error(`[Worker] Error al eliminar timestamps: ${err}`))
      );
    }
    
    if (compressedAudioFilename) {
      const waveformPath = join(PUBLIC_DIR, 'waveforms', `${compressedAudioFilename}.json`);
      if (fs.existsSync(waveformPath)) {
        cleanupFiles.push(
          fsp.unlink(waveformPath)
            .then(() => console.log(`[Worker] Limpieza: waveform eliminado`))
            .catch(err => console.error(`[Worker] Error al eliminar waveform: ${err}`))
        );
      }
    }
    
    await Promise.allSettled(cleanupFiles);
    
    throw error;
  }
};

// SOLO registrar el procesador si estamos en el proceso worker
const isWorkerProcess = process.argv[1] && (
  process.argv[1].endsWith('worker.js') || 
  process.argv[1].endsWith('src/worker.js') ||
  process.argv[1].includes('src\\worker.js')
);

if (isWorkerProcess) {
  console.log('[Worker] Registrando procesador de trabajos...');
  songQueue.process(processSong);
  
  songQueue.on('completed', (job, result) => {
    console.log(`[Worker] Job ${job.id} completado exitosamente`);
  });

  songQueue.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job.id} falló:`, err.message);
  });

  songQueue.on('progress', (job, progress) => {
    console.log(`[Worker] Job ${job.id} progreso: ${progress}%`);
  });

  songQueue.on('error', (error) => {
    console.error('[Queue] Error en la cola:', error);
  });
}