# Documentación de la integración Enkontrol

Versión documentada: **0.1.0** · Revisión: **19 de octubre de 2026**.

Esta documentación describe el código de este repositorio independiente. Distingue el comportamiento implementado de los requisitos pendientes para operar contra Enkontrol. No certifica un despliegue ni una conexión real desde la VM.

## Guía de lectura

| Documento | Destinatario | Contenido |
|---|---|---|
| [Arquitectura y alcance](architecture.md) | Negocio, arquitectura y desarrollo | Componentes, flujos, límites y decisiones |
| [Configuración](configuration.md) | Desarrollo y operaciones | Variables, aplicaciones, modos y validaciones |
| [Instalación en Windows/VM](deployment-windows.md) | TI y administrador del servidor | Preparación, instalación, arranque, HTTPS y migración |
| [Referencia HTTP](api.md) | Desarrolladores consumidores | Endpoints, permisos, ejemplos y errores |
| [OpenAPI 3.1](openapi.json) | Desarrolladores y herramientas | Contrato importable de la API |
| [Datos y sincronización](data-and-sync.md) | Desarrollo y administrador de datos | Payload, cola, estados, reintentos y limitaciones |
| [Contrato Enkontrol y plantilla de mapeo](erp-contract.md) | Administrador ERP y responsables de negocio | Información que falta para habilitar escrituras |
| [Seguridad](security.md) | TI y seguridad | Secretos, permisos, red y datos personales |
| [Operación y recuperación](operations.md) | Soporte y operaciones | Monitoreo, errores, respaldos y rollback |
| [Ampliación a otras aplicaciones](extension-guide.md) | Desarrollo | MongoDB adicionales y módulos futuros |
| [Pruebas y aceptación](testing.md) | QA, TI y negocio | Evidencia disponible y validaciones pendientes |

## Estado real del proyecto

Implementado: lectura del CRM desde MongoDB, API por aplicación, cola en MongoDB independiente, modo preview, sondeo y adaptador ODBC con verificación de identidad y llamada parametrizada.

Pendiente: procedimiento de integración y mapeo de Enkontrol, validación ODBC en Windows, pruebas con MongoDB real, despliegue, dominio/certificado, monitoreo externo y aprobación funcional. Proveedores, visor y sincronización ERP → MongoDB todavía no tienen módulo.

El servicio se entrega en modo `preview`. Ese modo **sí escribe instantáneas en la base hub**, pero no escribe en Enkontrol ni en MongoDB del CRM. No confundir una vista previa con una integración activa.

## Responsables por definir

| Rol | Decisión o tarea |
|---|---|
| Responsable CRM | Etapas, datos autorizados y significado de venta/integración |
| Administrador Enkontrol | Archivo de pruebas, tablas, reglas, procedimientos y equivalencias |
| TI de infraestructura | VM Windows, ODBC, red, TLS, cuenta de servicio, backups y arranque |
| Desarrollo | Mapeo, implementación pendiente, pruebas y módulos adicionales |
| Operaciones | Alertas, reintentos, incidentes y restauración |

Actualizar estos documentos junto con el código cuando cambien endpoints, estados, variables o contratos. Todos los ejemplos contienen datos ficticios o placeholders; nunca incorporar credenciales reales.
