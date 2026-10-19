import { readFile } from 'node:fs/promises';

export function validateConfig(env, definitions) {
  const required = (key) => {
    if (!env[key]?.trim()) throw new Error(`Missing configuration: ${key}`);
    return env[key];
  };
  const mode = env.SYNC_MODE || 'preview';
  if (!['preview', 'live'].includes(mode)) throw new Error('Invalid SYNC_MODE');
  const port = Number(env.PORT || 4080);
  const pollSeconds = Number(env.POLL_SECONDS || 30);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(pollSeconds) || pollSeconds < 5) {
    throw new Error('Invalid port or polling interval');
  }
  if (!Array.isArray(definitions) || !definitions.length) throw new Error('No apps configured');
  const ids = new Set();
  const keys = new Set();
  const apps = definitions.map((app) => {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(app.id) || ids.has(app.id)) throw new Error('Invalid/duplicate app id');
    ids.add(app.id);
    if (app.module !== 'crm') throw new Error(`Unimplemented module: ${app.module}`);
    if (!Array.isArray(app.eligibleStates) || !app.eligibleStates.length || app.eligibleStates.some(s => typeof s !== 'string' || !s)) throw new Error('Invalid eligibleStates');
    if (!Array.isArray(app.scopes) || app.scopes.some(s => !['read', 'enqueue', 'erp:inspect'].includes(s))) throw new Error('Invalid scopes');
    if (app.erpProcedure && !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(app.erpProcedure)) throw new Error('Invalid procedure identifier');
    const apiKey = required(app.apiKeyEnv);
    if (apiKey.length < 32 || apiKey.startsWith('replace-') || keys.has(apiKey)) throw new Error('API keys must be unique random secrets of at least 32 characters');
    keys.add(apiKey);
    return { ...app, apiKey, mongoUri: required(app.mongoUriEnv), mongoDb: required(app.mongoDbEnv) };
  });
  const config = {
    host: env.HOST || '127.0.0.1', port, pollSeconds, mode, apps,
    hubUri: required('HUB_MONGODB_URI'), hubDb: required('HUB_MONGODB_DB'),
    erp: { connectionString: env.EK_ODBC_CONNECTION_STRING, server: env.EK_EXPECTED_SERVER,
      database: env.EK_EXPECTED_DATABASE, file: env.EK_EXPECTED_FILE,
      writes: env.EK_WRITES_ENABLED === 'true' }
  };
  if (apps.some(a => a.mongoDb === config.hubDb)) throw new Error('Use a separate hub database');
  if (mode === 'live' && (!config.erp.writes || !config.erp.connectionString || !config.erp.server || !config.erp.database || !config.erp.file || apps.some(a => !a.erpProcedure))) {
    throw new Error('Live mode requires ERP identity, file, explicit write enablement and procedures for every app');
  }
  return config;
}

export async function loadConfig(env = process.env) {
  return validateConfig(env, JSON.parse(await readFile(env.APPS_FILE || './apps.local.json', 'utf8')));
}
