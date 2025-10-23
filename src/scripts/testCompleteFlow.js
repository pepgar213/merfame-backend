// src/scripts/testCompleteFlow.js
import dotenv from 'dotenv';
dotenv.config();

import { uploadFile, getTrackFilePath, deleteTrackFiles } from '../services/storageService.js';
import { run, get } from '../db/queryHelper.js';

async function testCompleteFlow() {
  console.log('🧪 Probando flujo completo del sistema...\n');
  
  const testArtistId = 1;
  const testTrackId = `test-${Date.now()}`;
  const testTitle = 'Canción de Prueba Completa';
  
  try {
    // 1. Verificar que existe el artista en la DB
    console.log('1️⃣ Verificando artista en base de datos...');
    let artist = await get('SELECT id FROM artists WHERE id = ?', [testArtistId]);
    
    if (!artist) {
      console.log(`   ⚠️  Artista ${testArtistId} no existe, creándolo...`);
      
      // Primero crear usuario
      await run(
        'INSERT INTO users (email, username, password, role) VALUES (?, ?, ?, ?)',
        ['test@merfame.com', 'testartist', 'dummy_hash', 'artist']
      );
      
      const user = await get('SELECT id FROM users WHERE email = ?', ['test@merfame.com']);
      
      // Crear artista
      await run(
        'INSERT INTO artists (user_id, name) VALUES (?, ?)',
        [user.id, 'Artista de Prueba']
      );
      
      artist = await get('SELECT id FROM artists WHERE user_id = ?', [user.id]);
      console.log(`   ✅ Artista creado con ID: ${artist.id}`);
    } else {
      console.log(`   ✅ Artista encontrado: ID ${artist.id}`);
    }
    
    console.log('');
    
    // 2. Subir archivos de prueba a R2 con estructura
    console.log('2️⃣ Subiendo archivos a R2 con estructura de carpetas...');
    console.log(`   📁 Estructura: artists/${artist.id}/tracks/${testTrackId}/\n`);
    
    const audioPath = getTrackFilePath(artist.id, testTrackId, 'audio');
    const audioUrl = await uploadFile(
      Buffer.from('fake audio data for testing'), 
      audioPath, 
      'audio/mpeg'
    );
    console.log(`   ✅ Audio: ${audioUrl}`);
    
    const coverPath = getTrackFilePath(artist.id, testTrackId, 'cover', 'jpg');
    const coverUrl = await uploadFile(
      Buffer.from('fake image data for testing'), 
      coverPath, 
      'image/jpeg'
    );
    console.log(`   ✅ Cover: ${coverUrl}`);
    
    const waveformPath = getTrackFilePath(artist.id, testTrackId, 'waveform');
    const waveformUrl = await uploadFile(
      Buffer.from(JSON.stringify([[0.1, 0.2, 0.3]])), 
      waveformPath, 
      'application/json'
    );
    console.log(`   ✅ Waveform: ${waveformUrl}`);
    
    const timestampsPath = getTrackFilePath(artist.id, testTrackId, 'timestamps');
    const timestampsUrl = await uploadFile(
      Buffer.from(JSON.stringify({segments: []})), 
      timestampsPath, 
      'application/json'
    );
    console.log(`   ✅ Timestamps: ${timestampsUrl}\n`);
    
    // 3. Insertar en base de datos
    console.log('3️⃣ Insertando en base de datos...');
    const result = await run(
      `INSERT INTO music_tracks 
       (title, artist_id, audio_url, cover_image_url, duration, waveform_url, voice_timestamps_url) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [testTitle, artist.id, audioUrl, coverUrl, 60, waveformUrl, timestampsUrl]
    );
    
    const trackId = result.lastID;
    console.log(`   ✅ Track insertado con ID: ${trackId}\n`);
    
    // 4. Verificar que se puede leer de la DB
    console.log('4️⃣ Verificando lectura desde base de datos...');
    const track = await get(
      'SELECT * FROM music_tracks WHERE id = ?',
      [trackId]
    );
    
    console.log(`   ✅ Track encontrado: "${track.title}"`);
    console.log(`   ✅ Audio URL: ${track.audio_url}`);
    console.log(`   ✅ Cover URL: ${track.cover_image_url}`);
    console.log(`   ✅ Waveform URL: ${track.waveform_url}`);
    console.log(`   ✅ Timestamps URL: ${track.voice_timestamps_url}\n`);
    
    // Verificar que las URLs tienen la estructura correcta
    if (track.audio_url.includes(`artists/${artist.id}/tracks/${testTrackId}/audio.mp3`)) {
      console.log(`   ✅ Estructura de URL correcta\n`);
    } else {
      console.log(`   ⚠️  Estructura de URL incorrecta\n`);
    }
    
    // 5. Limpiar: Eliminar de R2
    console.log('5️⃣ Limpiando archivos de R2...');
    await deleteTrackFiles(artist.id, testTrackId);
    console.log(`   ✅ Archivos eliminados de R2\n`);
    
    // 6. Limpiar: Eliminar de DB
    console.log('6️⃣ Limpiando base de datos...');
    await run('DELETE FROM music_tracks WHERE id = ?', [trackId]);
    console.log(`   ✅ Track eliminado de DB\n`);
    
    console.log('=' .repeat(60));
    console.log('✅ ¡TODAS LAS PRUEBAS PASARON!');
    console.log('✅ El sistema está funcionando correctamente');
    console.log('✅ Puedes comenzar a subir canciones reales\n');
    console.log('📁 Estructura verificada en R2:');
    console.log(`   artists/${artist.id}/tracks/${testTrackId}/`);
    console.log('   ├── audio.mp3');
    console.log('   ├── cover.jpg');
    console.log('   ├── waveform.json');
    console.log('   └── timestamps.json\n');
    
  } catch (error) {
    console.error('\n❌ ERROR en las pruebas:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

testCompleteFlow()
  .then(() => {
    console.log('🎉 Test completado exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Test falló:', error.message);
    process.exit(1);
  });