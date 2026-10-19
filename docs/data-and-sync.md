# Datos y sincronización

[Índice](README.md)

## Instantánea CRM v1

```json
{
  "schemaVersion": 1,
  "appId": "crm",
  "entity": "lead",
  "sourceId": "aaaaaaaaaaaaaaaaaaaaaaaa",
  "lead": {
    "_id": "aaaaaaaaaaaaaaaaaaaaaaaa",
    "nombreCompleto": "Persona de prueba",
    "telefono": "+520000000000",
    "correo": "prueba@example.com",
    "fuente": "Sitio Web",
    "tipoPropiedad": "casa",
    "estado": "compra",
    "notas": "Registro ficticio",
    "etiquetasInternas": []
  },
  "activities": [],
  "visits": []
}
```

La proyección no agrega campos ausentes ni valida todos los tipos de negocio. El esquema de Mongo debe ser consistente con el CRM; el futuro mapeo ERP debe validar obligatorios, tipos, longitudes y equivalencias.

| Grupo | Campos incluidos cuando existen |
|---|---|
| Lead | `_id`, `nombreCompleto`, `telefono`, `correo`, `fuente`, `campaña`, `proyectoInteres`, `tipoPropiedad`, `rangoPresupuesto`, `estado`, `asesorAsignadoId`, `notas`, `etiquetasInternas`, `fechaProximaAccion`, `createdAt`, `updatedAt` |
| Actividades | `_id`, `tipo`, `leadId`, `usuarioId`, `descripcion`, `createdAt` |
| Visitas | `_id`, `leadId`, `asesorId`, `fechaHora`, `duracionMinutos`, `ubicacion`, `estado`, `notas` |

Las relaciones se buscan por `leadId` de tipo **cadena**, no ObjectId. Actividades y visitas se ordenan por `_id`. ObjectId se convierte a hexadecimal y Date a ISO UTC; claves de objetos se ordenan para el hash, arrays conservan su orden. Campos `undefined` se omiten. Fechas inválidas o datos incompatibles pueden causar error; no se corrigen silenciosamente.

No se leen usuarios, contraseñas, conversaciones WhatsApp, adjuntos ni casos de postventa. `asesorAsignadoId`, `usuarioId` y `asesorId` son identificadores Mongo, no códigos de Enkontrol. No existe relación automática con inmueble/lote ERP.

Límites: 1000 actividades, 1000 visitas y 1 MiB JSON por snapshot. Se lee hasta 1001 relaciones para detectar exceso. Si se excede, no se genera una instantánea recortada.

## Base hub

`sync_jobs` conserva **un documento por app y lead**, no un evento por cambio.

| Campo | Significado |
|---|---|
| `_id` | `{appId}:lead:{sourceId}` |
| `appId`, `sourceId` | Identidad del origen |
| `payload` | Última instantánea capturada, con datos personales |
| `desiredHash` | SHA-256 del contenido que se quiere enviar |
| `sentHash` | Hash de última revisión confirmada por ERP |
| `previewHash`, `previewedAt` | Revisión marcada por ciclo preview y fecha |
| `erpId`, `syncedAt` | Última respuesta ERP confirmada |
| `createdAt`, `updatedAt` | Creación y cambio de revisión de trabajo |
| `attempts` | Intentos reclamados; reinicia con nueva revisión |
| `nextAttemptAt` | Fecha mínima de próximo intento |
| `leaseUntil`, `leaseToken` | Reserva temporal y propietario del intento |
| `errorCode` | Último error resumido |
| `suspended` | Excluye el trabajo de nuevas reclamaciones |

Índices: `_id` de Mongo, único `(appId, sourceId)` y compuesto `(appId, nextAttemptAt, leaseUntil)`. La API excluye `payload` y `leaseToken` del estado, pero el payload es accesible mediante preview reconstruido desde Mongo.

`service_locks`: documento `_id: worker` con `owner` y `expiresAt`. No es una colección TTL; el proceso reclama el registro si expiró. La cola tampoco tiene TTL ni purga automática.

## Estados calculados

Orden de evaluación real: suspendido → hashes iguales → lease vigente → error presente → preview coincidente → pendiente.

| Estado | Condición / interpretación |
|---|---|
| `suspended` | Origen eliminado, no elegible o inválido detectado antes de entrega |
| `synced` | `sentHash === desiredHash`; confirma esa revisión, no todas las futuras |
| `processing` | Lease del trabajo vigente |
| `retry_pending` | Hay error; esperar `nextAttemptAt` |
| `previewed` | Ciclo preview marcó la revisión; no valida reglas ni escritura ERP |
| `pending` | Revisión por procesar |

Una vista previa HTTP no cambia el estado del trabajo. El ciclo preview puede marcar instantáneas previamente capturadas; no es garantía de que todo siga idéntico en origen. Un trabajo ya sincronizado no se marca automáticamente suspendido cuando el lead sale de etapa porque no vuelve a reclamarse; no se transmite una cancelación al ERP.

## Sondeo, reservas y reintentos

- Un ciclo consulta hasta 100 leads elegibles por app. Cursor `_id` en memoria; al terminar vuelve al inicio. Un reinicio vuelve al principio sin borrar trabajos.
- Las apps se recorren secuencialmente; una app lenta aumenta la latencia de las siguientes.
- Espera `POLL_SECONDS` después del ciclo completo. No es frecuencia exacta de calendario.
- En live, hasta 25 trabajos por app/ciclo. Lease por trabajo de 120 s. No se renueva individualmente durante la llamada.
- Lease global de cinco minutos con heartbeat cada 30 s. El proceso sale si no puede renovarlo. No equivale a un bloqueo transaccional dentro de SQL.
- Reintentos: `min(3600, 5 × 2^min(attempts,12))` segundos; primer fallo normalmente 10 s. Sin límite máximo de intentos ni jitter interno.
- Si la revisión cambió antes del envío: captura la nueva, registra `SOURCE_CHANGED` y la reintenta después.
- Si el lead vuelve a ser elegible, la captura vuelve a poner `suspended=false`.

La latencia depende del número de leads, duración de consultas, otros módulos y backlog. No existe garantía de actualización en tiempo real.

## Consistencia y pendientes relevantes

No hay transacción entre lectura del lead y relaciones, ni entre Mongo y ERP. La captura puede mezclar cambios concurrentes. La revisión se vuelve a comprobar antes de entregar, pero aún puede cambiar durante la llamada.

Una respuesta perdida después del commit ERP genera un reintento: el procedimiento debe deduplicar. Cambios intermedios pueden ser reemplazados por el último snapshot, incluidos cambios de etapa muy breves. El hash de contenido reutiliza la clave si reaparece una versión idéntica; resolver la secuencia A → B → A antes de live si el negocio depende de eventos u orden.

Los rechazos durante sondeo se cuentan en `lastPoll.rejected`, pero no se crea un registro detallado para cada nuevo lead rechazado. No hay DLQ ni auditoría histórica inmutable. Para investigar, usar preview sobre el ID y registrar el incidente fuera de la API.
