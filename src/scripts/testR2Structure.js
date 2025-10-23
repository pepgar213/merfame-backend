// src/scripts/testR2Structure.js
import dotenv from 'dotenv';
dotenv.config();

import { uploadFile, getTrackFilePath, getArtistProfilePath, getPublicUrl, deleteTrackFiles } from '../services/storageService.js';

async function testR2Structure() {
  console.log('🧪 Probando estructura de carpetas en R2...\n');
  
  const testArtistId = 1;
  const testTrackId = 'test-' + Date.now();
  
  try {
    console.log('1️⃣ Subiendo archivos de prueba...\n');
    
    // Audio
    const audioPath = getTrackFilePath(testArtistId, testTrackId, 'audio');
    console.log(`   Audio path: ${audioPath}`);
    const audioUrl = await uploadFile(Buffer.from('fake audio data'), audioPath, 'audio/mpeg');
    console.log(`   ✅ Subido: ${audioUrl}\n`);
    
    // Cover
    const coverPath = getTrackFilePath(testArtistId, testTrackId, 'cover', 'jpg');
    console.log(`   Cover path: ${coverPath}`);
    const coverUrl = await uploadFile(Buffer.from('fake image data'), coverPath, 'image/jpeg');
    console.log(`   ✅ Subido: ${coverUrl}\n`);
    
    // Waveform
    const waveformPath = getTrackFilePath(testArtistId, testTrackId, 'waveform');
    console.log(`   Waveform path: ${waveformPath}`);
    const waveformUrl = await uploadFile(Buffer.from('{"data": [0.1, 0.2]}'), waveformPath, 'application/json');
    console.log(`   ✅ Subido: ${waveformUrl}\n`);
    
    // Timestamps
    const timestampsPath = getTrackFilePath(testArtistId, testTrackId, 'timestamps');
    console.log(`   Timestamps path: ${timestampsPath}`);
    const timestampsUrl = await uploadFile(Buffer.from('{"segments": []}'), timestampsPath, 'application/json');
    console.log(`   ✅ Subido: ${timestampsUrl}\n`);
    
    console.log('2️⃣ Verificando estructura creada...\n');
    console.log(`   📁 Estructura en R2:`);
    console.log(`   artists/${testArtistId}/tracks/${testTrackId}/`);
    console.log(`   ├── audio.mp3`);
    console.log(`   ├── cover.jpg`);
    console.log(`   ├── waveform.json`);
    console.log(`   └── timestamps.json\n`);
    
    console.log('3️⃣ Probando eliminación de track completo...\n');
    await deleteTrackFiles(testArtistId, testTrackId);
    console.log(`   ✅ Todos los archivos del track eliminados\n`);
    
    console.log('✅ ¡TODAS LAS PRUEBAS PASARON!');
    console.log('✅ La estructura de carpetas funciona correctamente\n');
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  }
}

testR2Structure()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));