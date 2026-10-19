# Integrar otras aplicaciones

[Índice](README.md)

## Qué se puede configurar hoy

Se pueden registrar varias bases que usen **el mismo esquema CRM**, con IDs y claves diferentes. Por ejemplo, otra instancia del CRM:

```json
{
  "id": "crm-sucursal",
  "module": "crm",
  "mongoUriEnv": "SUCURSAL_MONGODB_URI",
  "mongoDbEnv": "SUCURSAL_MONGODB_DB",
  "apiKeyEnv": "SUCURSAL_API_KEY",
  "scopes": ["read", "enqueue"],
  "eligibleStates": ["compra"],
  "erpProcedure": ""
}
```

Agregar esta entrada al array, definir variables, probar en preview y reiniciar. La clave anterior no puede acceder a la ruta de la nueva aplicación. Las fuentes pueden estar en hosts Mongo distintos. La validación requiere que sus nombres de base sean distintos del nombre del hub.

## Qué requiere desarrollo

Portal de proveedores y visor **no funcionan** solo cambiando `module`. El código acepta únicamente `crm`; las rutas, IDs de trabajo y buena parte del flujo usan `lead`. La arquitectura separa módulos, pero no es un motor de plugins completo.

Pasos para un módulo nuevo:

1. Definir entidad, campos autorizados, identidad, sistemas maestros y dirección del flujo.
2. Implementar acceso Mongo con colección/proyección fijas; no permitir consultas arbitrarias enviadas por HTTP.
3. Registrar el módulo en `config.mjs` y `main.mjs`.
4. Generalizar `service.mjs` y `store.mjs`: clave `(appId, entity, sourceId)`, revisión, elegibilidad, suspensión y contrato de captura. Migrar el índice único actual si una app admite más de una entidad.
5. Agregar rutas y scopes específicos en `http.mjs`, evitando que una clave de CRM adquiera acceso a proveedores.
6. Implementar adaptador/procedimiento ERP y validar transacciones, deduplicación y equivalencias.
7. Agregar tests de aislamiento, fallos, paginación y recuperación; actualizar OpenAPI y manuales.
8. Ejecutar aceptación en pruebas antes de añadirlo al despliegue live.

## Portal de proveedores: decisiones pendientes

Definir si el portal crea solicitudes o proveedores definitivos, quién aprueba altas, dónde residen documentos, cómo se vincula RFC/ID ERP y qué estados pueden volver al portal. El servicio actual no transfiere documentos ni tiene flujo de aprobación.

No asumir que una clave API por aplicación resuelve autorización entre proveedores: el backend del portal debe filtrar qué proveedor puede consultar cada registro.

## Visor ERP → MongoDB

Requiere un conector de lectura ERP con proyección y paginación, estrategia de cambios (marca temporal, secuencia o mecanismo confirmado por el administrador), checkpoint durable, tratamiento de bajas, carga inicial y escritura idempotente en Mongo destino.

Definir retraso aceptable, campos, volumen y límites de consulta antes de elegir sondeo o streaming. SQL Anywhere 11 no garantiza un mecanismo CDC compatible con esta implementación. No hay sincronización inversa ni actualizaciones en tiempo real desarrolladas todavía.

## Evolución del contrato

Mantener versión del payload, migraciones del hub y compatibilidad de consumidores. Un cambio de mapeo no cambia automáticamente el hash si el payload es idéntico: definir cómo forzar una nueva revisión sin borrar confirmaciones. Para eventos de negocio considerar una secuencia monotónica además del hash, especialmente A → B → A.

El modo y el destino ERP son globales. Si distintas apps requieren aislamiento operativo o destinos diferentes, separar procesos/hubs o desarrollar configuración por destino; no asumir que ya existe.
