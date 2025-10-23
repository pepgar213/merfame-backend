// src/scripts/testR2Connection.js
import dotenv from 'dotenv';
dotenv.config();

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function testR2Connection() {
  console.log('🧪 Probando conexión a Cloudflare R2...\n');
  
  const testFileName = `test-${Date.now()}.txt`;
  const testContent = 'Hello from Merfame! 🎵';
  
  try {
    // 1. Probar subida (PUT)
    console.log('1️⃣ Probando subida de archivo...');
    await r2Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: testFileName,
      Body: testContent,
      ContentType: 'text/plain',
    }));
    console.log('   ✅ Archivo subido correctamente');
    console.log(`   📎 URL: ${process.env.R2_PUBLIC_URL}/${testFileName}\n`);
    
    // 2. Probar lectura (GET)
    console.log('2️⃣ Probando lectura de archivo...');
    const getResponse = await r2Client.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: testFileName,
    }));
    const downloadedContent = await getResponse.Body.transformToString();
    console.log('   ✅ Archivo leído correctamente');
    console.log(`   📄 Contenido: "${downloadedContent}"\n`);
    
    // 3. Probar listado (LIST)
    console.log('3️⃣ Probando listado de archivos...');
    const listResponse = await r2Client.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      MaxKeys: 5,
    }));
    console.log(`   ✅ Bucket contiene ${listResponse.KeyCount} archivo(s)`);
    if (listResponse.Contents) {
      listResponse.Contents.forEach(obj => {
        console.log(`   📁 ${obj.Key} (${obj.Size} bytes)`);
      });
    }
    console.log('');
    
    // 4. Probar eliminación (DELETE)
    console.log('4️⃣ Probando eliminación de archivo...');
    await r2Client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: testFileName,
    }));
    console.log('   ✅ Archivo eliminado correctamente\n');
    
    // 5. Verificar acceso público
    console.log('5️⃣ Verificando acceso público...');
    console.log(`   🌐 Abre esta URL en tu navegador:`);
    console.log(`   ${process.env.R2_PUBLIC_URL}\n`);
    
    console.log('✅ ¡TODAS LAS PRUEBAS PASARON EXITOSAMENTE!');
    console.log('✅ R2 está configurado correctamente\n');
    
  } catch (error) {
    console.error('❌ ERROR en las pruebas:', error.message);
    console.error('\n🔍 Posibles causas:');
    console.error('   1. Credenciales incorrectas en .env');
    console.error('   2. Bucket no existe o nombre incorrecto');
    console.error('   3. Permisos del API Token insuficientes');
    console.error('   4. Account ID incorrecto\n');
    throw error;
  }
}

testR2Connection()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));