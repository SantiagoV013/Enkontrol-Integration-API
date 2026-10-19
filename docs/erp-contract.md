# Contrato Enkontrol y plantilla de mapeo

[Índice](README.md)

Este contrato está **pendiente de implementación y validación en Enkontrol**. La API contiene el punto de conexión, no los INSERT/UPDATE finales ni un procedimiento instalado. No ejecutar altas directamente basándose en nombres de tablas.

## Evidencia disponible

En DBeaver se observó SQL Anywhere 11.0.0.1264, servidor `test_ck` y base `EK_ADM01_11`. Las siguientes tablas se encontraron en catálogo; sus funciones son hipótesis por nombre, todavía sin validar columnas ni relaciones:

| Tabla | Interpretación por confirmar |
|---|---|
| `spr_prospecto` | Prospectos |
| `spr_prospecto_agente` | Asignación de agente |
| `spr_prospecto_bitacora` | Seguimiento |
| `spr_prospecto_estatus` | Estatus |
| `spr_prospecto_inmueble`, `spr_prospecto_lote` | Relación inmobiliaria |
| `sm_cliente` | Clientes; confirmar módulo y uso comercial |

Consultar identidad sin escribir:

```sql
SELECT DB_NAME() AS base_actual,
       PROPERTY('Name') AS servidor,
       DB_PROPERTY('File') AS archivo;
```

El administrador debe confirmar el archivo completo y que es una copia de pruebas. Servicio y base pueden tener nombres iguales entre ambientes; no basta una etiqueta `test`.

## Llamada prevista

```text
CALL propietario.procedimiento(?, ?, ?, ?)
```

| Posición | Dato | Contrato |
|---|---|---|
| 1 | `app_id` | Aplicación configurada, máximo 40 caracteres |
| 2 | `source_id` | ID Mongo del lead en hexadecimal, 24 caracteres |
| 3 | `idempotency_key` | `{appId}:lead:{sourceId}:{desiredHash}`; reservar al menos 135 caracteres |
| 4 | `payload_json` | JSON v1 hasta 1 MiB; validar encoding y capacidad del tipo SQL |

Respuesta: primera fila con columna `erp_id`, valor no nulo ni vacío. El adaptador acepta nombre de columna en distinta capitalización y lo convierte a cadena. No se exige actualmente tipo más estricto; acordar longitud/formato en el mapeo.

El nombre debe ser `propietario.procedimiento` con identificadores simples. El payload, IDs y clave se envían como parámetros ODBC. No aceptar fragmentos SQL dentro del JSON.

## Obligaciones del procedimiento

1. Validar versión, aplicación, campos obligatorios, longitudes, catálogos y permisos.
2. Encontrar/crear la relación única `(app_id, source_id)` con la entidad ERP.
3. Deduplicar `idempotency_key`; una repetición después de respuesta perdida devuelve el mismo resultado.
4. Aplicar cambios de negocio, tablas relacionadas y registro de idempotencia **en la misma transacción**.
5. Ante error, revertir completamente y devolver un fallo; no confirmar parcialmente.
6. Resolver conversión prospecto→cliente, folios, agente, empresa, proyecto, lote y estados según reglas de Enkontrol.
7. Definir tratamiento de revisiones repetidas, fuera de orden, bajas y reversión de venta. La implementación de cola no resuelve todos esos casos.

SQL Anywhere 11 no debe suponerse compatible con funciones JSON modernas. Validar el mecanismo de interpretación; si no existe uno adecuado, sustituir este contrato por parámetros tipados y adaptar `src/erp.mjs`. No instalar un parser o modificar procedimientos del ERP sin revisar compatibilidad con su proveedor.

## Plantilla para completar con negocio y administrador

Copiar esta tabla por entidad. Usar ejemplos ficticios.

| Campo Mongo / dato | Significado | Tabla.campo ERP | Tipo y longitud ERP | Obligatorio | Transformación / catálogo | Default o generación | Validado por |
|---|---|---|---|---|---|---|---|
| `sourceId` | Identidad del origen | Pendiente | Pendiente | Sí en relación de integración | No usar como folio ERP sin validación | ID Mongo existente | Pendiente |
| `lead.nombreCompleto` | Nombre del contacto | Pendiente | Pendiente | Por definir | ¿Nombre completo o separado? | — | Pendiente |
| `lead.telefono` | Teléfono | Pendiente | Pendiente | Por definir | País/formato/extensión | — | Pendiente |
| `lead.correo` | Correo | Pendiente | Pendiente | Por definir | Normalización y duplicados | — | Pendiente |
| `lead.estado` | Etapa CRM | Pendiente | Pendiente | Sí para flujo | Tabla de equivalencias | — | Pendiente |
| `lead.asesorAsignadoId` | Asesor Mongo | Pendiente | Pendiente | Por definir | Equivalencia con agente ERP | — | Pendiente |
| `lead.proyectoInteres` | Proyecto | Pendiente | Pendiente | Por definir | Equivalencia con proyecto/empresa ERP | — | Pendiente |
| `lead.tipoPropiedad` | Casa/departamento | Pendiente | Pendiente | Por definir | Catálogo ERP | — | Pendiente |
| `lead.rangoPresupuesto` | Rango, no importe de venta | Pendiente | Pendiente | Por definir | No convertir a precio contractual automáticamente | — | Pendiente |
| `activities`, `visits` | Seguimiento | Pendiente | Pendiente | Por definir | Relación, tipos y zona horaria | — | Pendiente |

## Preguntas de negocio

- ¿Qué operación exacta debe ocurrir al pasar a Integración y a Venta? En el CRM hoy solo existe `compra` como etapa final equivalente por confirmar.
- ¿Enkontrol o el CRM es autoridad de cada campo? ¿Qué ediciones se permiten después del alta?
- ¿Cómo se detectan duplicados ya existentes sin ID Mongo? ¿Quién resuelve coincidencias ambiguas?
- ¿Qué empresa, sucursal, proyecto y agente deben asignarse? ¿Existe ID explícito de inmueble/lote?
- ¿Los folios se generan por procedimiento, secuencia u otra lógica?
- ¿Qué procedimientos/triggers existen y qué tablas deben actualizarse juntas?
- ¿Cómo se anula una operación o se corrige una venta? La API no tiene reversión automática.

## Criterio para habilitar live

Mapeo firmado/validado, archivo de pruebas confirmado, procedimiento implementado, cuenta ERP limitada, transporte y driver verificados, pruebas de duplicados/rollback/reintentos superadas, y revisión de trabajos históricos pendientes. Completar `EK_EXPECTED_FILE`, `erpProcedure`, `EK_WRITES_ENABLED=true` y `SYNC_MODE=live` solo después de esos pasos.
