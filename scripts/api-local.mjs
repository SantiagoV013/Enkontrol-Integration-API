const [path = '/v1/apps/crm/status', method = 'GET'] = process.argv.slice(2);
if (!path.startsWith('/') || path.startsWith('//') || !['GET', 'POST'].includes(method)) {
  throw new Error('Uso: node --env-file=.env scripts/api-local.mjs /ruta [GET|POST]');
}
const base = new URL(`http://127.0.0.1:${process.env.PORT || 4080}`);
const url = new URL(path, base);
if (url.origin !== base.origin) throw new Error('Solo se permiten rutas locales.');
const response = await fetch(url, { method, headers: { Authorization: `Bearer ${process.env.CRM_API_KEY}` }, signal: AbortSignal.timeout(15000) });
console.log(`HTTP ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exitCode = 1;
