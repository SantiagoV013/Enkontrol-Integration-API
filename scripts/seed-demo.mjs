import { MongoClient, ObjectId } from 'mongodb';

if (process.env.CRM_MONGODB_URI !== 'mongodb://127.0.0.1:27018' || process.env.CRM_MONGODB_DB !== 'crm_demo' || process.env.SYNC_MODE !== 'preview') {
  throw new Error('Este script requiere la configuración local crm_demo en modo preview.');
}
const client = new MongoClient(process.env.CRM_MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
try {
  await client.connect();
  const db = client.db('crm_demo');
  for (const [id, nombreCompleto, estado] of [
    ['000000000000000000000001', 'Ana Ejemplo', 'compra'],
    ['000000000000000000000002', 'Luis Prueba', 'compra'],
    ['000000000000000000000003', 'Marta Demo', 'nuevo'],
  ]) {
    await db.collection('leads').updateOne({ _id: new ObjectId(id) }, { $set: {
      nombreCompleto, estado, correo: `demo${id.slice(-1)}@example.com`, fuente: 'demo-local',
      notas: 'Datos ficticios para probar la API.',
    } }, { upsert: true });
  }
  await db.collection('actividades').updateOne({ _id: new ObjectId('000000000000000000000011') }, { $set: {
    leadId: '000000000000000000000001', tipo: 'nota', descripcion: 'Actividad ficticia de prueba.',
  } }, { upsert: true });
  console.log('Listo: 3 leads ficticios (2 elegibles) y 1 actividad en crm_demo.');
} finally {
  await client.close();
}
