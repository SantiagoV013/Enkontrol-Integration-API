# Seguridad y acceso

[Índice](README.md)

## Límites de confianza

La API autentica servidores consumidores. No autentica usuarios finales del CRM ni replica sus roles: una clave con `read` puede consultar todos los leads elegibles de su aplicación. El servidor del CRM debe aplicar autorización de usuario antes de llamar a la integración.

Cada aplicación tiene clave diferente; se compara mediante SHA-256 y comparación de tiempo constante. No hay expiración, OAuth, refresh tokens, mTLS ni rotación con dos claves simultáneas implementados. El operador debe custodiar y rotar los secretos.

## Permisos recomendados

| Recurso | Acceso necesario |
|---|---|
| MongoDB CRM | Lectura en `leads`, `actividades`, `visitas` y acceso suficiente para ping |
| MongoDB hub | Lectura/escritura en `sync_jobs`, `service_locks`, creación de índices y ping |
| SQL Anywhere preview | Conexión y consulta de identidad; sin escritura de negocio |
| SQL Anywhere live | Identidad y ejecución del procedimiento validado; limitar acceso directo a tablas según política ERP |
| Sistema Windows | Lectura de archivos/configuración, ejecución Node, uso de System DSN y conectividad requerida |

Las cuentas concretas y sus privilegios deben validarse con los administradores. La aplicación no crea usuarios, permisos ni certificados. No reutilizar DBA como cuenta ordinaria de integración.

## Secretos

`.env` y `apps.local.json` están excluidos de Git. Los archivos de ejemplo no deben contener secretos reales. Las cadenas Mongo y ODBC se almacenan localmente o se inyectan mediante el gestor de secretos de TI; el código no integra automáticamente un vault.

No enviar claves al navegador, URL, capturas, herramientas externas de IA o tickets. Si se expusieron credenciales durante la preparación, rotarlas coordinadamente antes de operar. No se incorporó la contraseña compartida en la conversación a esta implementación ni documentación.

Para rotar: generar una nueva clave, actualizar el entorno del servicio y el consumidor, reiniciar y verificar 401 para la anterior y acceso para la nueva. Como solo se admite una clave por app, planificar una breve interrupción coordinada.

## Transporte

HTTPS termina en un proxy administrado. Node escucha en loopback por defecto; no incluye TLS propio. Mongo debe usar las opciones TLS adecuadas del URI. El transporte ODBC depende del DSN/driver: verificar cifrado y certificados disponibles en la versión real de SQL Anywhere. La API no fuerza cifrado ODBC por código. Si la versión limita TLS, TI debe definir red privada, túnel o actualización compatible; no deshabilitar validaciones a ciegas.

No publicar el puerto SQL a Internet. Si Node y SQL corren en equipos diferentes, limitar la regla de entrada SQL a la IP del servicio. Una regla para la Mac de desarrollo no autoriza automáticamente a la VM.

## Información personal y registros

La cola guarda nombre, contacto, notas, actividades y visitas. Debe protegerse como el CRM. No hay cifrado de campo ni política de retención automática: respaldos, cifrado en reposo y eliminación autorizada son responsabilidad operativa pendiente.

Los logs del servicio registran eventos y códigos, no payload ni mensajes completos del driver. Esta reducción puede dificultar diagnóstico; no habilitar logs indiscriminados en producción. Proxy, supervisor y Mongo pueden generar sus propios logs y deben revisarse por separado.

## Controles implementados y límites

Autenticación por app, scopes, proyecciones, parámetros SQL, lista fija de rutas, límites de paginación y tamaño, identidad ERP y bloqueo de escrituras por defecto. No hay auditoría completa por petición exitosa, protección DDoS, políticas por usuario final, control de empresa dentro de la app ni aprobación humana de cada envío.
