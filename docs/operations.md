# Operación, soporte y recuperación

[Índice](README.md)

## Comprobaciones habituales

1. Revisar que la tarea/proceso esté activo y haya un solo propietario del hub.
2. Consultar `/health/live` para vida del proceso.
3. Consultar `/v1/apps/crm/status`: Mongo, modo y antigüedad de `lastPoll`.
4. Revisar trabajos representativos con `/leads/{id}/status` y errores en logs.
5. Consultar `/erp/identity` cuando se investigue el ERP, sin usarlo como ping de alta frecuencia.

No existen endpoints de lista general de trabajos ni métricas de backlog. El operador puede hacer consultas de lectura al hub con su herramienta autorizada. Ejemplo en mongosh, seleccionando primero la base hub correcta:

```javascript
db.sync_jobs.aggregate([
  { $match: { appId: "crm" } },
  { $group: { _id: "$errorCode", trabajos: { $sum: 1 } } }
]);
db.sync_jobs.find(
  { appId: "crm", $expr: { $ne: ["$desiredHash", "$sentHash"] } },
  { payload: 0, leaseToken: 0 }
).limit(20);
```

La segunda consulta incluye preview y trabajos suspendidos; no equivale a “fallos”. No exportar payloads para monitoreo.

## Señales y alertas sugeridas

| Señal | Interpretación |
|---|---|
| Proceso caído / STARTUP_FAILED | Configuración, dependencias, permisos, conexión o lease |
| `lastPoll=null` prolongado | Ningún ciclo completó desde el arranque |
| Último sondeo muy antiguo | Ciclo bloqueado, fallo o volumen alto |
| `rejected > 0` | Capturas omitidas por inexistencia, etapa o límites |
| `poll_failed` repetido | Fallo de fuente/hub o captura ocupada |
| `retry_pending` prolongado | ERP, identidad, mapeo o confirmación fallando |
| `synced` | Solo esa revisión recibió `erp_id` y se confirmó en hub |

Definir umbrales según volumen y duración real; no fijar 30 s como SLA porque ese valor es solo la pausa entre ciclos. Los monitores/alertas no están desplegados por este proyecto.

## Diagnóstico

| Síntoma | Revisar |
|---|---|
| STARTUP_FAILED | JSON válido, variables requeridas, claves distintas, DNS, cuentas, base hub separada y lease activo |
| No inicia tras caída | El lease global puede durar hasta cinco minutos; confirmar que la instancia anterior terminó |
| HTTP 401 | App correcta, Bearer exacto, clave y reinicio después de cambiar entorno |
| HTTP 403 | Scope necesario; no cambiar permisos de otras apps |
| HTTP 409 APP_BUSY_RETRY | Sondeo o captura en curso; reintentar con espera y jitter |
| HTTP 422 | Exceso de relaciones/tamaño; decidir partición contractual, no recortar sin autorización |
| ERP_NOT_CONFIGURED | Cadena ODBC ausente |
| DEPENDENCY_UNAVAILABLE en identidad | Driver opcional no instalado, DSN/arquitectura, cuenta, red o fallo ODBC |
| ERP_IDENTITY_MISMATCH | Nombre real de base, servicio y archivo frente a variables esperadas |
| ERP_ACK_INVALID | Procedimiento no devuelve primera fila `erp_id` válido; pudo haber commit |
| DELIVERY_FAILED | Error no público en llamada o confirmación; comprobar logs de infraestructura sin revelar secretos |
| SOURCE_CHANGED | Cambió el contenido antes del envío; se capturó la nueva revisión |
| No aparecen leads | Etapas exactas, nombre de base/colección, permisos, IDs ObjectId y cursor del ciclo |

Ante error de red, probar host/puerto desde la **VM** bajo su contexto de red. Un éxito desde la Mac no demuestra acceso desde la VM. No corregir un mismatch cambiando variables para aceptar producción sin validar destino.

## Pausar y recuperar

- **Parar todo:** detener el proceso mediante el supervisor; no iniciar otra instancia en paralelo.
- **Preparar sin enviar:** detener, establecer `SYNC_MODE=preview` y `EK_WRITES_ENABLED=false`, reiniciar. El servicio seguirá leyendo fuentes y escribiendo hub.
- **Pausar una app:** no existe toggle HTTP. Retirar temporalmente su entrada de configuración y reiniciar, conservando sus trabajos. El archivo debe contener al menos una app.
- **Reintentar:** los fallos se reintentan automáticamente. POST sync recaptura; con el mismo hash no reinicia necesariamente el backoff. No existe “forzar reintento ahora”.
- **Origen eliminado/no elegible:** corregir en CRM solo si procede; la captura elegible reactiva el trabajo. No implica borrar o revertir lo ya escrito en ERP.

No eliminar el hub ni cambiar `appId` para resolver fallos: puede perder relaciones, cambiar claves y provocar nuevas altas. No borrar `service_locks` mientras haya procesos activos.

## Respaldo y restauración

Respaldar versiones de código/lockfile, configuración por canal seguro, hub y registros de idempotencia/relación en ERP. Definir retención, RPO/RTO y responsables con TI. Mongo fuente mantiene su política de respaldo independiente.

Una restauración del hub a un momento anterior puede reintentar operaciones ya aplicadas en ERP. Si el ERP conserva las claves de idempotencia, debe devolver el resultado original. Restaurar ERP y hub a momentos distintos exige reconciliación, no activar live automáticamente.

Procedimiento de recuperación: detener workers, restaurar en ambiente de recuperación, verificar identidad y claves, iniciar preview, comparar trabajos/ERP y aprobar reanudación. No hay herramienta automática de reconciliación incluida.

## Ticket de incidente

Registrar fecha UTC/local, versión, appId, sourceId si procede, requestId, código de error, estado, último sondeo, cambio reciente de configuración y resultado de conectividad. No incluir contraseña, token, URI con credenciales ni información personal del lead. Conservar evidencia de si el ERP confirmó una operación antes del fallo.
