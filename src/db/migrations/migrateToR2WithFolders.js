// src/scripts/migrateToR2WithFolders.js
import fs from 'fs/promises';
import path from 'path';
import { uploadFile, getTrackFilePath } from '../services/storageService.js';
import { query, run } from '../db/queryHelper.js';

const PUBLIC_DIR = path.join(process.cwd(), 'public');

async function migrateFiles() {
  console.log('🚀 Iniciando migración de archivos a R2 con estructura de carpetas...\n');
  
  try {
    // Obtener todas las canciones de la base de datos
    const tracks = await query(
      `SELECT mt.id, mt.title, mt.artist_id, mt.audio_url, mt.cover_image_url, 
              mt.waveform_url, mt.voice_timestamps_url
       FROM music_tracks mt
       ORDER BY mt.id`
    );

    console.log(`📊 Encontradas ${tracks.length} canciones para migrar\n`);

    for (const track of tracks) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🎵 Migrando: ${track.title} (ID: ${track.id})`);
      console.log(`   Artista ID: ${track.artist_id}`);
      
      // Generar ID único para este track
      const trackUniqueId = `migrated-${track.id}-${Date.now()}`;
      console.log(`   Track Unique ID: ${trackUniqueId}`);
      console.log(`   Estructura: artists/${track.artist_id}/tracks/${trackUniqueId}/`);

      let newAudioUrl = null;
      let newCoverUrl = null;
      let newWaveformUrl = null;
      let newTimestampsUrl = null;

      // 1. Migrar audio
      if (track.audio_url && !track.audio_url.startsWith('http')) {
        console.log(`   📁 Migrando audio...`);
        const localPath = path.join(PUBLIC_DIR, track.audio_url.replace(/^\//, ''));
        
        try {
          const buffer = await fs.readFile(localPath);
          const audioPath = getTrackFilePath(track.artist_id, trackUniqueId, 'audio');
          newAudioUrl = await uploadFile(buffer, audioPath, 'audio/mpeg');
          console.log(`   ✅ Audio migrado: ${newAudioUrl}`);
        } catch (error) {
          console.error(`   ❌ Error migrando audio: ${error.message}`);
        }
      }

      // 2. Migrar cover image
      if (track.cover_image_url && !track.cover_image_url.startsWith('http')) {
        console.log(`   📁 Migrando cover...`);
        const localPath = path.join(PUBLIC_DIR, track.cover_image_url.replace(/^\//, ''));
        
        try {
          const buffer = await fs.readFile(localPath);
          const ext = path.extname(localPath).substring(1);
          const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
          const coverPath = getTrackFilePath(track.artist_id, trackUniqueId, 'cover', ext);
          newCoverUrl = await uploadFile(buffer, coverPath, contentType);
          console.log(`   ✅ Cover migrado: ${newCoverUrl}`);
        } catch (error) {
          console.error(`   ❌ Error migrando cover: ${error.message}`);
        }
      }

      // 3. Migrar waveform
      if (track.waveform_url && !track.waveform_url.startsWith('http')) {
        console.log(`   📁 Migrando waveform...`);
        const localPath = path.join(PUBLIC_DIR, track.waveform_url.replace(/^\//, ''));
        
        try {
          const buffer = await fs.readFile(localPath);
          const waveformPath = getTrackFilePath(track.artist_id, trackUniqueId, 'waveform');
          newWaveformUrl = await uploadFile(buffer, waveformPath, 'application/json');
          console.log(`   ✅ Waveform migrado: ${newWaveformUrl}`);
        } catch (error) {
          console.error(`   ❌ Error migrando waveform: ${error.message}`);
        }
      }

      // 4. Migrar timestamps
      if (track.voice_timestamps_url && !track.voice_timestamps_url.startsWith('http')) {
        console.log(`   📁 Migrando timestamps...`);
        const localPath = path.join(PUBLIC_DIR, track.voice_timestamps_url.replace(/^\//, ''));
        
        try {
          const buffer = await fs.readFile(localPath);
          const timestampsPath = getTrackFilePath(track.artist_id, trackUniqueId, 'timestamps');
          newTimestampsUrl = await uploadFile(buffer, timestampsPath, 'application/json');
          console.log(`   ✅ Timestamps migrado: ${newTimestampsUrl}`);
        } catch (error) {
          console.error(`   ❌ Error migrando timestamps: ${error.message}`);
        }
      }

      // 5. Actualizar URLs en la base de datos
      if (newAudioUrl || newCoverUrl || newWaveformUrl || newTimestampsUrl) {
        console.log(`   💾 Actualizando base de datos...`);
        
        await run(
          `UPDATE music_tracks 
           SET audio_url = COALESCE(?, audio_url),
               cover_image_url = COALESCE(?, cover_image_url),
               waveform_url = COALESCE(?, waveform_url),
               voice_timestamps_url = COALESCE(?, voice_timestamps_url)
           WHERE id = ?`,
          [newAudioUrl, newCoverUrl, newWaveformUrl, newTimestampsUrl, track.id]
        );
        
        console.log(`   ✅ Base de datos actualizada`);
      }

      console.log(`✅ Track migrado completamente`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ ¡Migración completada exitosamente!');
    console.log(`\n📊 Resumen:`);
    console.log(`   - Tracks migrados: ${tracks.length}`);
    console.log(`   - Estructura: artists/{artist_id}/tracks/{track_unique_id}/`);
    console.log(`\n⚠️  Recuerda:`);
    console.log('   1. Cambiar STORAGE_MODE=r2 en tu .env');
    console.log('   2. Reiniciar el servidor y worker');
    console.log('   3. Verificar que todo funciona correctamente');
    console.log('   4. Hacer backup de /public antes de eliminar archivos locales');
    console.log('   5. Eliminar archivos locales de /public si todo está OK\n');
    
  } catch (error) {
    console.error('❌ Error durante la migración:', error);
    throw error;
  } finally {
    process.exit();
  }
}

migrateFiles();