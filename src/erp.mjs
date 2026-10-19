import { PublicError } from './crm.mjs';

export class EnkontrolAdapter {
  constructor(config, connect) { this.config = config; this.connect = connect; }
  async withConnection(fn) {
    if (!this.config.connectionString) throw new PublicError(503, 'ERP_NOT_CONFIGURED');
    const connect = this.connect || (await import('odbc')).default.connect;
    const connection = await connect({ connectionString: this.config.connectionString, loginTimeout: 10, connectionTimeout: 30 });
    try { return await fn(connection); } finally { await connection.close(); }
  }
  async identity(connection) {
    const rows = await connection.query("SELECT DB_NAME() AS db_name, PROPERTY('Name') AS server_name, DB_PROPERTY('File') AS db_file", [], { timeout: 15 });
    const row = rows[0];
    const identity = Object.fromEntries(Object.entries(row || {}).map(([k,v]) => [k.toLowerCase(), v]));
    if (identity.db_name !== this.config.database || identity.server_name !== this.config.server ||
      (this.config.file && identity.db_file !== this.config.file)) throw new PublicError(503, 'ERP_IDENTITY_MISMATCH');
    return identity;
  }
  async inspect() { return this.withConnection(c => this.identity(c)); }
  async deliver(app, job) {
    if (!this.config.writes || !this.config.file || !app.erpProcedure) throw new PublicError(503, 'ERP_MAPPING_NOT_ENABLED');
    if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(app.erpProcedure)) throw new PublicError(503, 'INVALID_PROCEDURE');
    return this.withConnection(async c => {
      await this.identity(c);
      // The ERP procedure must atomically deduplicate this key and upsert by appId/sourceId.
      // A retry after an unknown commit MUST return the original erp_id.
      const rows = await c.query(`CALL ${app.erpProcedure}(?, ?, ?, ?)`,
        [app.id, job.sourceId, `${job._id}:${job.desiredHash}`, JSON.stringify(job.payload)], { timeout: 30 });
      const result = Object.fromEntries(Object.entries(rows[0] || {}).map(([k,v]) => [k.toLowerCase(), v]));
      if (result.erp_id === undefined || result.erp_id === null || result.erp_id === '') throw new PublicError(502, 'ERP_ACK_INVALID');
      return String(result.erp_id);
    });
  }
}
