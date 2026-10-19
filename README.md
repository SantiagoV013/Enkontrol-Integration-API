# API de integración Enkontrol

**Documentación completa:** [índice de manuales](docs/README.md), [referencia HTTP](docs/api.md) y [OpenAPI 3.1](docs/openapi.json).

Servicio Node.js independiente para instalar en la VM. Lee directamente MongoDB; no necesita cambios en el CRM ni expone SQL arbitrario. Primera implementación: módulo CRM. Otras aplicaciones tienen conexiones y credenciales independientes; módulos de proveedores y visualización quedan pendientes de sus contratos de datos.

## Qué funciona y qué falta

- API autenticada por aplicación, consultas de leads elegibles, vista previa y solicitudes de sincronización.
- Sondeo automático con paginación por `_id`, cola persistente en una base MongoDB separada, revisión por hash, reintentos con espera creciente y comprobación de etapa antes del envío.
- Adaptador ODBC para identidad de SQL Anywhere y llamada parametrizada a un procedimiento de integración.
- Modo inicial `preview`: lee el CRM y escribe únicamente la cola de integración. **No escribe en Enkontrol ni indica un envío como sincronizado.**
- **Pendiente para activar envíos:** verificar columnas, reglas y relaciones de Enkontrol; implementar allí el procedimiento de alta/actualización con idempotencia. No se inventaron INSERT sobre `spr_prospecto` o `sm_cliente`.
- No desplegado en la VM, no probado contra ODBC ni bases reales. Las pruebas automatizadas usan dobles de dependencias. No se copiaron credenciales de la conversación ni del CRM.

## Instalación local / Windows VM

1. Instalar Node.js 22, y para acceso al ERP el cliente/driver ODBC de SQL Anywhere compatible con la instalación 11. El driver y Node deben tener la misma arquitectura. El módulo npm `odbc` puede necesitar herramientas de compilación de Windows. No usa el driver de Microsoft SQL Server ni el JDBC de DBeaver.
2. Copiar esta carpeta a `C:\EnkontrolIntegration`. Ejecutar `npm ci --omit=dev`. ODBC es opcional para poder probar `preview` sin cliente nativo; verificar que se instaló antes de usar `/erp/identity` o modo `live`: `npm ls odbc`.
3. Copiar `.env.example` a `.env` y `apps.example.json` a `apps.local.json`. Completar credenciales **localmente**, con acceso restringido a la cuenta de servicio. Generar cada clave con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
4. Para MongoDB usar una cuenta de lectura en la base del CRM; otra con escritura e índices en `enkontrol_integration`. Esta base guarda datos personales de las instantáneas: aplicar el mismo control de acceso y respaldo que al CRM. No usar el usuario DBA del ERP para producción.
5. Configurar un **System DSN** `EnkontrolTest` en Windows: host `127.0.0.1` si el ERP está en esa VM, o su dirección real; puerto `49158`, servicio `test_ck`, base `EK_ADM01_11`. No confundir servicio con base. Permitir tráfico solo desde el host de integración. Configurar TLS de MongoDB y la protección de transporte ODBC que admita el servidor; nunca deshabilitar validación de certificados como solución automática.
6. Ejecutar `npm start` desde la carpeta del servicio. Para la primera prueba mantener `SYNC_MODE=preview`.

El `.env` raíz del CRM no se carga automáticamente. Las contraseñas no se almacenan en `apps.local.json`, solo los nombres de variables. Para cambiar de servidor físico a VM se actualizan las variables/DSN, no el código.

## Endpoints

Todos excepto salud requieren `Authorization: Bearer <clave de la aplicación>`. No enviar esta clave al navegador: consumir desde los servidores de cada app.

| Método | Ruta | Permiso / resultado |
|---|---|---|
| GET | `/health/live` | Proceso activo, no comprueba dependencias |
| GET | `/v1/apps/crm/status` | `read`: Mongo disponible, modo y último sondeo |
| GET | `/v1/apps/crm/erp/identity` | `erp:inspect`: servidor, base y archivo; falla si no coinciden con configuración |
| GET | `/v1/apps/crm/leads?limit=50&after=ID` | `read`: leads elegibles, máximo 100 por página |
| GET | `/v1/apps/crm/leads/ID/preview` | `read`: datos que se prepararán para Enkontrol |
| POST | `/v1/apps/crm/leads/ID/sync` | `enqueue`: captura desde Mongo; sin cuerpo, devuelve 202, **no confirma entrega** |
| GET | `/v1/apps/crm/leads/ID/status` | `read`: pendiente, vista previa, procesando, reintento, suspendido o sincronizado; ID ERP si existe |

No hay endpoints para ejecutar SQL, seleccionar colecciones arbitrarias, registrar conexiones desde HTTP o leer otras aplicaciones con la misma clave. Hay límite de 120 solicitudes/minuto por IP; detrás del proxy todas pueden compartir cuota. No se confía en `X-Forwarded-For`.

Ejemplo PowerShell (clave ingresada solo en la sesión local):

```powershell
$headers = @{ Authorization = "Bearer $env:CRM_API_KEY" }
Invoke-RestMethod http://127.0.0.1:4080/v1/apps/crm/status -Headers $headers
Invoke-RestMethod http://127.0.0.1:4080/v1/apps/crm/erp/identity -Headers $headers
```

## Etapas, datos y actualización

El CRM actual define `compra`; no define `integracion` ni `venta`. `eligibleStates` controla qué valores activan la captura. Agregar nombres al archivo no crea etapas en la interfaz del CRM. Una primera ejecución también captura leads históricos que ya estén en esas etapas.

La instantánea versión 1 incluye los campos declarados del lead, actividades (sin metadata libre) y visitas. No incluye contraseñas, registros de usuarios, conversaciones WhatsApp, archivos ni postventa. Asesor se transmite como ID Mongo, todavía sin equivalencia con agente ERP. Límites: 1000 actividades y 1000 visitas por lead, 1 MiB por instantánea; si se exceden, el sondeo cuenta el rechazo y el endpoint de vista previa devuelve 422, nunca trunca silenciosamente.

Se revisan 100 leads por ciclo. Al terminar la lista, se inicia nuevamente para detectar ediciones y cambios de datos relacionados. Latencia aproximada: `ceil(leads_elegibles / 100) × POLL_SECONDS` más tiempo de consultas y envíos. No es tiempo real estricto, ni captura transiciones muy breves entre sondeos. Si es obligatorio capturar cada transición, se necesitará outbox transaccional en el CRM o change streams con retención/resume tokens. La captura actual de lead y relaciones no es una transacción consistente entre colecciones.

Cada entidad tiene un trabajo durable; un hash evita repetir versiones ya entregadas. La API y el sondeo serializan capturas por app; si está ocupada, responde 409 y el cliente debe reintentar. Solo una instancia activa del servicio por base hub; un lease evita arrancar dos workers. Después de un cierre abrupto puede tardar cinco minutos en expirar. En modo live se procesan hasta 25 trabajos por ciclo; fallos reintentan indefinidamente hasta una hora entre intentos, visibles en status. Eliminar/revertir un lead suspende el trabajo al revalidarlo; no elimina nada en ERP. Si vuelve a ser elegible, el sondeo lo reactiva. Puede haber un cambio en origen entre la revalidación y el commit ERP: se sincronizará en el siguiente ciclo, no se promete atomicidad entre motores.

## Contrato pendiente de Enkontrol (antes de live)

Configurar un procedimiento por aplicación, por ejemplo `DBA.import_crm`, **solo después de implementarlo con el administrador de Enkontrol**. El nombre es ilustrativo; no existe ni se crea automáticamente.

La llamada ODBC usa cuatro parámetros: `app_id`, `source_id`, `idempotency_key`, `payload_json`. Debe devolver una fila con `erp_id`. El procedimiento debe:

1. Validar y mapear el payload según las reglas reales del ERP, incluyendo equivalencias de asesor, proyecto y catálogos.
2. Mantener una relación única `(app_id, source_id)` para actualizar el mismo prospecto/cliente.
3. Guardar la clave de idempotencia y el resultado **en la misma transacción** que los cambios de negocio. Una repetición debe devolver el resultado original sin escribir dos veces.
4. Gestionar el paso de prospecto a cliente y todas sus tablas dependientes de forma atómica. Un error debe revertir la transacción.

SQL Anywhere 11 no debe suponerse compatible con funciones JSON modernas: se debe validar el método de interpretación del JSON o reemplazar el adaptador por un mapeo parametrizado de campos tipados. Hasta resolverlo, `live` no es una integración terminada.

Confirmar con el administrador que el archivo de `DB_PROPERTY('File')` es la copia de pruebas, no solo que el servicio se llama `test_ck`. Completar `EK_EXPECTED_FILE` con la ruta exacta. Para live también se requieren `EK_WRITES_ENABLED=true`, `SYNC_MODE=live` y `erpProcedure` por app. El adaptador verifica servidor/base/archivo antes de cada llamada.

El servicio ofrece entrega **al menos una vez**, no exactamente una vez: puede fallar Mongo después de un commit ERP, o vencer un lease. La idempotencia del procedimiento es obligatoria. Ninguna escritura real debe habilitarse sin probar recuperación tras un commit con respuesta perdida.

## Ejecutar automáticamente en la VM

Usar una cuenta de servicio con acceso al DSN, `.env` y a Mongo. En el Programador de tareas de Windows crear una tarea al iniciar el equipo, ejecutar aunque no haya sesión, con reinicio ante fallo y sin instancias paralelas:

- Programa: ruta absoluta de `node.exe`.
- Argumentos: `--env-file=C:\EnkontrolIntegration\.env C:\EnkontrolIntegration\src\main.mjs`.
- Iniciar en: `C:\EnkontrolIntegration` (para resolver `APPS_FILE`).

Publicar HTTPS mediante un proxy administrado (por ejemplo IIS ya configurado por TI) hacia `127.0.0.1:4080`. No abrir 4080 ni el puerto SQL a Internet. El worker puede funcionar solo con conexiones salientes a MongoDB; el CRM no necesita llamar la API para el sondeo. Un CRM alojado fuera de la red sí necesita una ruta segura al proxy para usar sus endpoints. Monitorizar `/status`, errores de sondeo, trabajos pendientes y respaldos. No afirmar despliegue hasta probarlo desde la VM.

## Más aplicaciones

Agregar una entrada con `id`, nombres de variables Mongo y una clave distinta. Varias instalaciones con el mismo esquema pueden usar `module: "crm"`. Para proveedores/visor implementar un módulo separado con proyección, validación, paginación y contrato ERP propios, y registrarlo en configuración y arranque. No reutilizar automáticamente el esquema de leads. La sincronización Enkontrol → MongoDB queda para ese módulo; esta versión implementa únicamente CRM → Enkontrol.

## Validación

`npm test`: autenticación y aislamiento por app, límites HTTP, hash estable, rechazo de configuración live incompleta, identidad ERP, consultas parametrizadas, revalidación de etapa, versión obsoleta, fallos y modo preview. Las pruebas no sustituyen una prueba real de persistencia y concurrencia MongoDB ni una prueba del driver en Windows.

Referencias: [node-odbc](https://github.com/IBM/node-odbc), [propiedades SQL Anywhere 11](https://infocenter.sybase.com/help/topic/com.sybase.help.sqlanywhere.11.0.0/dbadmin_en11/properties-perfapp.html).
