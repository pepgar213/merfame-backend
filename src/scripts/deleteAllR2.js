// src/scripts/deleteAllR2.js
import dotenv from 'dotenv';
dotenv.config();

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import readline from 'readline';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function deleteAllFiles() {
  console.log('\n' + '⚠️'.repeat(40));
  console.log('⚠️  ADVERTENCIA: ELIMINACIÓN COMPLETA DE R2');
  console.log('⚠️'.repeat(40) + '\n');

  console.log('Este script eliminará TODOS los archivos del bucket:');
  console.log(`Bucket: ${process.env.R2_BUCKET_NAME}\n`);

  // Primero listar archivos
  console.log('📋 Obteniendo lista de archivos...\n');
  let allKeys = [];
  let continuationToken = null;
  let totalSize = 0;

  try {
    do {
      const response = await r2Client.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));

      if (response.Contents && response.Contents.length > 0) {
        response.Contents.forEach(file => {
          allKeys.push(file.Key);
          totalSize += file.Size || 0;
        });
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    console.log(`📊 Total de archivos a eliminar: ${allKeys.length}`);
    console.log(`📦 Tamaño total: ${formatBytes(totalSize)}\n`);

    if (allKeys.length === 0) {
      console.log('✅ El bucket ya está vacío\n');
      rl.close();
      return;
    }

    // Confirmación 1
    const confirm1 = await question('¿Estás seguro que quieres eliminar TODOS estos archivos? (escribe "SI" para confirmar): ');
    
    if (confirm1.toUpperCase() !== 'SI') {
      console.log('\n❌ Operación cancelada\n');
      rl.close();
      return;
    }

    // Confirmación 2
    const confirm2 = await question('⚠️  ÚLTIMA CONFIRMACIÓN: Esta acción NO se puede deshacer. Escribe el nombre del bucket para confirmar: ');
    
    if (confirm2 !== process.env.R2_BUCKET_NAME) {
      console.log('\n❌ Nombre del bucket incorrecto. Operación cancelada\n');
      rl.close();
      return;
    }

    console.log('\n🗑️  Iniciando eliminación...\n');

    // Eliminar en lotes de 1000 (límite de AWS S3/R2)
    let deleted = 0;
    for (let i = 0; i < allKeys.length; i += 1000) {
      const batch = allKeys.slice(i, i + 1000);
      
      const deleteParams = {
        Bucket: process.env.R2_BUCKET_NAME,
        Delete: {
          Objects: batch.map(key => ({ Key: key })),
          Quiet: false,
        },
      };

      const response = await r2Client.send(new DeleteObjectsCommand(deleteParams));
      
      if (response.Deleted) {
        deleted += response.Deleted.length;
        console.log(`✅ Eliminados ${deleted}/${allKeys.length} archivos...`);
      }

      if (response.Errors && response.Errors.length > 0) {
        console.error('\n❌ Errores durante la eliminación:');
        response.Errors.forEach(err => {
          console.error(`   ${err.Key}: ${err.Message}`);
        });
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`✅ Eliminación completada: ${deleted} archivos eliminados`);
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Error durante la eliminación:', error.message);
    throw error;
  } finally {
    rl.close();
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

deleteAllFiles()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });