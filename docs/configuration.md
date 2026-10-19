# Configuración

[Índice](README.md)

Trabajar desde la carpeta del servicio. `npm start` usa `node --env-file=.env src/main.mjs`. No carga `.env.local` del CRM. Las variables ya presentes en el entorno del proceso tienen precedencia sobre el archivo cargado por Node; revisar especialmente las variables heredadas por la cuenta de servicio.

## Variables

| Variable | Valor inicial / regla | Uso |
|---|---|---|
| `HOST` | `127.0.0.1` | Escucha HTTP local; proxy delante para acceso externo |
| `PORT` | `4080`; entero 1–65535 | Puerto HTTP |
| `APPS_FILE` | `./apps.local.json` | Ruta relativa al directorio de trabajo o absoluta |
| `HUB_MONGODB_URI` | Obligatoria, secreta | Conexión a la cola y al lease global |
| `HUB_MONGODB_DB` | Obligatoria | Base hub, distinta por nombre de cada base fuente |
| `CRM_MONGODB_URI` | Referenciada en ejemplo | Conexión de lectura al CRM |
| `CRM_MONGODB_DB` | `crm_construkom` en ejemplo | Nombre de base fuente |
| `CRM_API_KEY` | Secreto aleatorio, mínimo 32 caracteres | Credencial HTTP del CRM |
| `SYNC_MODE` | `preview` o `live`; default `preview` | Modo compartido por todas las apps |
| `POLL_SECONDS` | `30`; entero mínimo 5 | Espera después de terminar cada ciclo |
| `EK_ODBC_CONNECTION_STRING` | Secreta; opcional para preview sin inspección ERP | DSN/credenciales ODBC |
| `EK_EXPECTED_SERVER` | `test_ck` en ejemplo | Nombre esperado del servidor SQL Anywhere |
| `EK_EXPECTED_DATABASE` | `EK_ADM01_11` en ejemplo | Nombre interno esperado de base |
| `EK_EXPECTED_FILE` | Vacía inicialmente | Ruta exacta del archivo; obligatoria para live |
| `EK_WRITES_ENABLED` | Solo el texto `true` habilita | Confirmación explícita de escritura |

Una inspección ERP requiere ODBC y nombres esperados de servidor/base aunque el modo sea preview. Si `EK_EXPECTED_FILE` está vacío, la inspección devuelve el archivo pero no lo contrasta. En live sí es obligatorio y se compara literalmente.

## Registro de aplicaciones

```json
[
  {
    "id": "crm",
    "module": "crm",
    "mongoUriEnv": "CRM_MONGODB_URI",
    "mongoDbEnv": "CRM_MONGODB_DB",
    "apiKeyEnv": "CRM_API_KEY",
    "scopes": ["read", "enqueue", "erp:inspect"],
    "eligibleStates": ["compra"],
    "erpProcedure": ""
  }
]
```

| Campo | Restricción |
|---|---|
| `id` | Único; inicia con letra minúscula; letras, números y guiones; máximo 40 caracteres |
| `module` | Actualmente solo `crm` |
| `mongoUriEnv`, `mongoDbEnv`, `apiKeyEnv` | Nombres de variables obligatorias, no valores secretos |
| `scopes` | Lista de `read`, `enqueue`, `erp:inspect`; no se heredan permisos entre apps |
| `eligibleStates` | Lista no vacía de cadenas; se comparan exactamente con `estado` |
| `erpProcedure` | Vacío en preview; para live `propietario.procedimiento`, identificadores simples sin espacios |

Las claves deben ser distintas entre apps y no pueden empezar por `replace-`. La validación de longitud no garantiza entropía: generar secretos aleatorios. Cualquier cambio de configuración requiere reiniciar el proceso.

El CRM define `nuevo`, `contactado`, `interesado`, `visita_agendada`, `visita_realizada`, `negociacion`, `compra`, `perdido`. Agregar `integracion` a este archivo no agrega esa etapa al CRM.

## Modos

| Acción | Preview | Live |
|---|---|---|
| Leer CRM y sus relaciones | Sí | Sí |
| Escribir cola hub | Sí | Sí |
| Consultar identidad ERP por endpoint | Si ODBC está configurado | Sí |
| Verificar identidad ERP al arrancar | No | Sí |
| Llamar al procedimiento ERP | No | Sí, tras revalidación |
| Marcar `synced` por entrega nueva | No | Tras respuesta ERP válida |

Al cambiar de preview a live, los trabajos pendientes e históricos pueden enviarse. No es un cambio cosmético. Revisar el conjunto completo antes de activarlo.
