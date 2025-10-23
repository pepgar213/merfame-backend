// src/db/migrations/migrateToR2WithFolders.js
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadFile, getTrackFilePath } from '../../services/storageService.js';
import { query, run } from '../queryHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'public');

async function migrateFiles() {
  console.log('🚀 Iniciando migración de archivos a R2 con estructura de carpetas...\n');
  console.log(`📂 Directorio público: ${PUBLIC_DIR}\n`);
  
  try {
    // Obtener todas las canciones de la base de datos
    console.log('📊 Consultando base de datos...');
    const tracks = await query(
      `SELECT mt.id, mt.title, mt.artist_id, mt.audio_url, mt.cover_image_url, 
              mt.waveform_url, mt.voice_timestamps_url
       FROM music_tracks mt
       ORDER BY mt.id`
    );

    console.log(`📊 Encontradas ${tracks.length} canciones para migrar\n`);

    if (tracks.length === 0) {
      console.log('⚠️  No hay canciones para migrar');
      return;
    }

    let migratedCount = 0;
    let errorCount = 0;

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
      let hasErrors = false;

      // 1. Migrar audio
      if (track.audio_url && !track.audio_url.startsWith('http')) {
        console.log(`   📁 Migrando audio...`);
        const localPath = path.join(PUBLIC_DIR, track.audio_url.replace(/^\//, ''));
        console.log(`      Ruta local: ${localPath}`);
        
        try {
          const buffer = await fs.readFile(localPath);
          const audioPath = getTrackFilePath(track.artist_id, trackUniqueId, 'audio');
          newAudioUrl = await uploadFile(buffer, audioPath, 'audio/mpeg');
          console.log(`   ✅ Audio migrado: ${newAudioUrl}`);
        } catch (error) {
          console.error(`   ❌ Error migrando audio: ${error.message}`);
          hasErrors = true;
        }
      } else {
        console.log(`   ⏭️  Audio ya está en R2 o no existe`);
      }

      // 2. Migrar cover image
      if (track.cover_image_url && !track.cover_image_url.startsWith('http')) {
        console.log(`   📁 Migrando cover...`);
        const localPath = path.join(PUBLIC_DIR, track.cover_image_url.replace(/^\//, ''));
        console.log(`      Ruta local: ${localPath}`);
        
        try {
          const buffer = await fs.readFile(localPath);
          const ext = path.extname(localPath).substring(1);
          const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
          const coverPath = getTrackFilePath(track.artist_id, trackUniqueId, 'cover', ext);
          newCoverUrl = await uploadFile(buffer, coverPath, contentType);
          console.log(`   ✅ Cover migrado: ${newCoverUrl}`);
        } catch (error) {
          console.error(`   ❌ Error migrando cover: ${error.message}`);
          hasErrors = true;
        }
      } else {
        console.log(`   ⏭️  Cover ya está en R2 o no existe`);
      }

      // 3. Migrar waveform
      if (track.waveform_url && !track.waveform_url.startsWith('http')) {
        console.log(`   📁 Migrando waveform...`);
        const localPath = path.join(PUBLIC_DIR, track.waveform_url.replace(/^\//, ''));
        console.log(`      Ruta local: ${localPath}`);
        
        try {
          const buffer = await fs.readFile(localPath);
          const waveformPath = getTrackFilePath(track.artist_id, trackUniqueId, 'waveform');
          newWaveformUrl = await uploadFile(buffer, waveformPath, 'application/json');
          console.log(`   ✅ Waveform migrado: ${newWaveformUrl}`);
        } catch (error) {
          console.error(`   ❌ Error migrando waveform: ${error.message}`);
          hasErrors = true;
        }
      } else {
        console.log(`   ⏭️  Waveform ya está en R2 o no existe`);
      }

      // 4. Migrar timestamps
      if (track.voice_timestamps_url && !track.voice_timestamps_url.startsWith('http')) {
        console.log(`   📁 Migrando timestamps...`);
        const localPath = path.join(PUBLIC_DIR, track.voice_timestamps_url.replace(/^\//, ''));
        console.log(`      Ruta local: ${localPath}`);
        
        try {
          const buffer = await fs.readFile(localPath);
          const timestampsPath = getTrackFilePath(track.artist_id, trackUniqueId, 'timestamps');
          newTimestampsUrl = await uploadFile(buffer, timestampsPath, 'application/json');
          console.log(`   ✅ Timestamps migrado: ${newTimestampsUrl}`);
        } catch (error) {
          console.error(`   ❌ Error migrando timestamps: ${error.message}`);
          hasErrors = true;
        }
      } else {
        console.log(`   ⏭️  Timestamps ya está en R2 o no existe`);
      }

      // 5. Actualizar URLs en la base de datos
      if (newAudioUrl || newCoverUrl || newWaveformUrl || newTimestampsUrl) {
        console.log(`   💾 Actualizando base de datos...`);
        
        try {
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
          migratedCount++;
        } catch (error) {
          console.error(`   ❌ Error actualizando base de datos: ${error.message}`);
          hasErrors = true;
        }
      } else {
        console.log(`   ⏭️  No hay archivos nuevos para actualizar en DB`);
      }

      if (hasErrors) {
        errorCount++;
        console.log(`⚠️  Track migrado con errores`);
      } else {
        console.log(`✅ Track migrado completamente`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ ¡Migración completada!');
    console.log(`\n📊 Resumen:`);
    console.log(`   - Total de tracks: ${tracks.length}`);
    console.log(`   - Migrados exitosamente: ${migratedCount}`);
    console.log(`   - Con errores: ${errorCount}`);
    console.log(`   - Estructura: artists/{artist_id}/tracks/{track_unique_id}/`);
    console.log(`\n⚠️  Próximos pasos:`);
    console.log('   1. Verifica que los archivos estén accesibles en R2');
    console.log('   2. Prueba la reproducción de algunas canciones');
    console.log('   3. Si todo funciona, cambia STORAGE_MODE=r2 en .env');
    console.log('   4. Reinicia el servidor y worker');
    console.log('   5. Haz backup de /public antes de eliminar archivos locales');
    console.log('   6. Elimina archivos locales de /public si todo está OK\n');
    
  } catch (error) {
    console.error('\n❌ Error crítico durante la migración:', error);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    process.exit();
  }
}

// Ejecutar la migración
console.log('🚀 Script de migración a R2 con estructura de carpetas');
console.log('=' .repeat(60));
console.log('');

migrateFiles().catch(error => {
  console.error('\n💥 La migración falló:', error.message);
  process.exit(1);
});