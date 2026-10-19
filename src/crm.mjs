import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';

export class PublicError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function objectId(value) {
  if (!/^[a-f0-9]{24}$/i.test(value || '')) throw new PublicError(400, 'INVALID_ID');
  return new ObjectId(value);
}

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof ObjectId) return JSON.stringify(value.toHexString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function revision(payload) {
  return createHash('sha256').update(canonical(payload)).digest('hex');
}

// Explicit projection: never copy usuarios/passwordHash or arbitrary future fields.
export const LEAD_FIELDS = { nombreCompleto: 1, telefono: 1, correo: 1, fuente: 1, campaña: 1,
  proyectoInteres: 1, tipoPropiedad: 1, rangoPresupuesto: 1, estado: 1, asesorAsignadoId: 1,
  notas: 1, etiquetasInternas: 1, fechaProximaAccion: 1, createdAt: 1, updatedAt: 1 };

export class CrmModule {
  constructor(db, app) { this.db = db; this.app = app; }
  async list(after, limit) {
    return this.db.collection('leads').find({ estado: { $in: this.app.eligibleStates },
      ...(after ? { _id: { $gt: objectId(after) } } : {}) }, { projection: LEAD_FIELDS })
      .sort({ _id: 1 }).limit(limit).toArray();
  }
  async snapshot(id) {
    const lead = await this.db.collection('leads').findOne({ _id: objectId(id) }, { projection: LEAD_FIELDS });
    if (!lead) throw new PublicError(404, 'LEAD_NOT_FOUND');
    if (!this.app.eligibleStates.includes(lead.estado)) throw new PublicError(409, 'LEAD_NOT_ELIGIBLE');
    const activities = await this.db.collection('actividades').find({ leadId: id },
      { projection: { tipo: 1, leadId: 1, usuarioId: 1, descripcion: 1, createdAt: 1 } }).sort({ _id: 1 }).limit(1001).toArray();
    const visits = await this.db.collection('visitas').find({ leadId: id },
      { projection: { leadId: 1, asesorId: 1, fechaHora: 1, duracionMinutos: 1, ubicacion: 1, estado: 1, notas: 1 } }).sort({ _id: 1 }).limit(1001).toArray();
    if (activities.length > 1000 || visits.length > 1000) throw new PublicError(422, 'RELATED_DATA_TOO_LARGE');
    const payload = JSON.parse(canonical({ schemaVersion: 1, appId: this.app.id, entity: 'lead', sourceId: id, lead, activities, visits }));
    if (Buffer.byteLength(JSON.stringify(payload)) > 1024 * 1024) throw new PublicError(422, 'PAYLOAD_TOO_LARGE');
    return payload;
  }
}
