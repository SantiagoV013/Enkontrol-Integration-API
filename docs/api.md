# Referencia HTTP v1

[Índice](README.md) · [OpenAPI importable](openapi.json)

Base local: `http://127.0.0.1:4080`. Para acceso remoto usar la URL HTTPS que publique TI. No hay Swagger UI servido por la aplicación; `openapi.json` es un archivo de documentación para importar en herramientas.

## Autenticación y respuesta

```http
Authorization: Bearer CLAVE_DE_LA_APLICACION
```

La clave debe pertenecer al `appId` de la ruta. Un ID de aplicación desconocido devuelve 401, igual que una clave inválida. `read` permite lectura de datos, `enqueue` solicitar capturas y `erp:inspect` inspeccionar identidad ERP. Los permisos HTTP **no deshabilitan el sondeo automático** de una app configurada.

Todas las respuestas normales incluyen JSON, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` y `X-Request-Id`. No existe un envoltorio uniforme `success/data`: respetar la forma de cada endpoint.

## Endpoints

| Método y ruta | Permiso | Respuesta |
|---|---|---|
| `GET /health/live` | Público | `200 {"status":"up"}` |
| `GET /v1/apps/{appId}/status` | read | Modo, disponibilidad Mongo y último sondeo |
| `GET /v1/apps/{appId}/erp/identity` | erp:inspect | `db_name`, `server_name`, `db_file` |
| `GET /v1/apps/{appId}/leads` | read | Lista de leads elegibles y cursor |
| `GET /v1/apps/{appId}/leads/{id}/preview` | read | Instantánea leída de Mongo, sin crear trabajo |
| `POST /v1/apps/{appId}/leads/{id}/sync` | enqueue | 202: captura persistida; no confirma entrega |
| `GET /v1/apps/{appId}/leads/{id}/status` | read | Estado del trabajo sin payload ni leaseToken |

`{id}` es un ObjectId hexadecimal de 24 caracteres. Las rutas de entidad con ID mal formado no coinciden y devuelven 404; un cursor `after` mal formado devuelve 400.

### Estado de aplicación

```json
{"mode":"preview","appId":"crm","mongoReady":true,"lastPoll":{"at":"2026-10-19T20:00:00.000Z","scanned":12,"rejected":0}}
```

`lastPoll` puede ser `null`; vive en memoria y se pierde al reiniciar. Describe el último ciclo completado, no un contador acumulado. `mongoReady` comprueba hub y **todas** las fuentes registradas; no comprueba el ERP. Si la comprobación da falso, se devuelve 503 con esta misma forma, no necesariamente un objeto `error`.

### Lista

Parámetros: `limit` entero 1–100, default 50; `after` ID del último elemento anterior. Orden ascendente por `_id`, exclusivamente etapas elegibles.

```json
{"data":[{"_id":"aaaaaaaaaaaaaaaaaaaaaaaa","nombreCompleto":"Persona de prueba","estado":"compra"}],"nextCursor":null}
```

Ejemplo abreviado: la respuesta real incluye los campos proyectados presentes. Si hay exactamente `limit` filas se devuelve cursor aunque la siguiente página resulte vacía. El consumidor debe seguir hasta `nextCursor: null`. No admite filtros por SQL, empresa ERP, colección o cualquier etapa elegida por el cliente.

### Vista previa y sincronización

La vista previa devuelve `{ "mode": "preview", "payload": { ... } }`; el modo puede ser live. Su contenido se documenta en [datos](data-and-sync.md).

`POST .../sync` no recibe cuerpo: cualquier `Transfer-Encoding` o Content-Length distinto de cero produce `BODY_NOT_ALLOWED`. El servidor lee Mongo; el consumidor no puede sustituir el lead con un JSON propio.

```json
{"mode":"preview","job":{"_id":"crm:lead:aaaaaaaaaaaaaaaaaaaaaaaa","appId":"crm","sourceId":"aaaaaaaaaaaaaaaaaaaaaaaa","status":"pending"}}
```

Respuesta abreviada: el trabajo incluye sus campos de control disponibles. Un POST repetido devuelve 202 y el estado actual, que puede ser `synced` si esa revisión ya se entregó. Es necesario consultar `/status` para confirmar.

### Identidad ERP

```json
{"db_name":"EK_ADM01_11","server_name":"test_ck","db_file":"C:\\RUTA_CONFIRMADA\\pruebas.db"}
```

La ruta del ejemplo es ficticia. Debe confirmarse con el administrador antes de habilitar live. Una identidad que no coincide devuelve 503; nunca se acepta el ERP indicado por el solicitante HTTP.

## Ejemplo de consumidor Node.js (solo servidor)

```javascript
const base = process.env.INTEGRATION_API_URL;
const token = process.env.INTEGRATION_CRM_KEY;
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // sustituir por ID real de pruebas
const response = await fetch(`${base}/v1/apps/crm/leads/${id}/sync`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(45000)
});
const result = await response.json();
if (!response.ok) throw new Error(result.error || `HTTP_${response.status}`);
// 202 significa aceptado, no entregado. Consultar el estado en una llamada posterior.
```

No usar variables `NEXT_PUBLIC_*` para claves. El timeout del cliente cancela su espera, no demuestra que el servidor no haya capturado el trabajo. Se puede reintentar la misma entidad; revisar la clave de contenido y sus límites en [sincronización](data-and-sync.md).

## Errores

Forma habitual: `{ "error": "CODIGO", "requestId": "uuid" }`. Las excepciones internas se reducen a `DEPENDENCY_UNAVAILABLE`, sin cadena de conexión ni texto del driver.

| HTTP | Códigos | Acción |
|---|---|---|
| 400 | INVALID_LIMIT, INVALID_ID, BODY_NOT_ALLOWED | Corregir parámetros/cuerpo |
| 401 | UNAUTHORIZED | Revisar aplicación, clave y encabezado |
| 403 | FORBIDDEN | Revisar scopes |
| 404 | NOT_FOUND, LEAD_NOT_FOUND, JOB_NOT_FOUND | Revisar ruta, ID o si existe captura |
| 405 | METHOD_NOT_ALLOWED | Revisar método; no todas las rutas inválidas producen 405 |
| 409 | APP_BUSY_RETRY | Reintentar con espera creciente y jitter |
| 409 | LEAD_NOT_ELIGIBLE | Revisar etapa del lead |
| 422 | RELATED_DATA_TOO_LARGE, PAYLOAD_TOO_LARGE | Revisar tamaño y contrato; no truncar datos |
| 429 | RATE_LIMITED | Reducir frecuencia; no se envía Retry-After |
| 503 | ERP_NOT_CONFIGURED, ERP_IDENTITY_MISMATCH, DEPENDENCY_UNAVAILABLE | Revisar instalación/configuración/conectividad |

`ERP_MAPPING_NOT_ENABLED`, `INVALID_PROCEDURE`, `ERP_ACK_INVALID`, `DELIVERY_FAILED` y `SOURCE_CHANGED` pueden aparecer como `errorCode` del trabajo. No son una confirmación de rollback del ERP. `errorCode` es diagnóstico resumido, no historial.

## Límites HTTP

120 solicitudes/minuto por IP de conexión, incluso salud. El proxy puede hacer que todos los consumidores compartan IP/cuota. La tabla de límites admite hasta 10 000 IP activas. Tiempo de recepción de petición 15 s, cabeceras 10 s y máximo 40 cabeceras; no constituyen un timeout total garantizado del handler. No hay CORS ni autenticación de navegador implementados.
