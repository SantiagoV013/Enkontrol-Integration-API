# Prueba local en Mac

Configuración de esta demo: API en `127.0.0.1:4080`, MongoDB en `127.0.0.1:27018`, origen `crm_demo`, cola `enkontrol_integration_demo`, modo `preview`. Solo contiene datos ficticios. No requiere ODBC ni escribe en Enkontrol.

Ejecutar los comandos desde `/Users/svo/Code/Untitled/Enkontrol-Integration-API`.

## Reiniciar la demo

Si los servicios ya están ejecutándose, no iniciarlos de nuevo. Para iniciarlos después de detenerlos, abrir dos terminales.

Primera terminal, MongoDB:

```sh
mkdir -p /private/tmp/enkontrol-api-demo-db
mongod --dbpath /private/tmp/enkontrol-api-demo-db --bind_ip 127.0.0.1 --port 27018 --logpath /private/tmp/enkontrol-api-demo-db/mongod.log
```

Segunda terminal, cargar datos e iniciar API:

```sh
node --env-file=.env scripts/seed-demo.mjs
npm start
```

El script de carga requiere la configuración local de la demo y puede repetirse. Los datos se guardan en una carpeta temporal que macOS podría limpiar; se pueden regenerar con este script. Detener primero la API y después MongoDB con Ctrl+C en sus terminales.

## Usar la API

El cliente local lee la clave de `.env` y agrega el encabezado `Authorization: Bearer ...` sin imprimirla.

```sh
# Estado de la API y conexión a MongoDB
node --env-file=.env scripts/api-local.mjs /v1/apps/crm/status

# Leads elegibles: Ana Ejemplo y Luis Prueba
node --env-file=.env scripts/api-local.mjs /v1/apps/crm/leads

# Payload de Ana, con su actividad relacionada
node --env-file=.env scripts/api-local.mjs /v1/apps/crm/leads/000000000000000000000001/preview

# Solicitar captura en la cola (202 significa aceptado)
node --env-file=.env scripts/api-local.mjs /v1/apps/crm/leads/000000000000000000000001/sync POST

# Estado del trabajo: previewed tras el sondeo
node --env-file=.env scripts/api-local.mjs /v1/apps/crm/leads/000000000000000000000001/status
```

El sondeo automático corre cada 30 segundos y también captura los leads elegibles. Marta Demo está en `nuevo`, por eso no aparece en el listado. En preview, `previewed` confirma la preparación local, no un envío al ERP.

Para comprobar salud desde el navegador: <http://127.0.0.1:4080/health/live>. Las demás rutas requieren la clave; usar el cliente anterior o configurar el encabezado en un cliente HTTP.
