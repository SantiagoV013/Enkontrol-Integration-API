# Pruebas y aceptación

[Índice](README.md)

## Evidencia disponible

La primera entrega ejecutó 13 pruebas automatizadas exitosas. Cubren configuración, API HTTP con servidor local y dobles de dependencias; **no usan MongoDB real ni ODBC/Enkontrol real**. La revisión de dependencias de esa entrega terminó sin vulnerabilidades reportadas; esto no certifica revisiones futuras ni el servidor Windows.

```powershell
Set-Location C:\EnkontrolIntegration
npm test
```

`npm test` no carga `.env` ni realiza escrituras al ERP. La prueba HTTP necesita abrir un puerto efímero local. Un entorno que bloquea sockets puede producir EPERM; no confundir con un fallo de autenticación.

| Prueba | Cobertura |
|---|---|
| Configuración | Live incompleto, claves repetidas, procedimiento inválido, módulo desconocido y hub separado |
| Hash | Orden de claves y cambios de contenido |
| CRM | ID incorrecto, lead ausente/no elegible |
| Identidad ERP | Bloqueo por servidor/base/archivo incorrectos antes de escritura |
| Escritura deshabilitada | No invoca el procedimiento |
| Parametrización | SQL fijo y clave estable al repetir llamada |
| Preview | No envía al ERP ni confirma entrega |
| Éxito worker | Confirma después de respuesta ERP |
| Reversión de etapa | Suspende antes de entrega |
| Payload obsoleto | Recaptura y no entrega revisión anterior |
| Fallo | Conserva código para reintento sin texto sensible |
| Concurrencia por app | Rechaza captura simultánea |
| HTTP | Autenticación por app, scopes, límites, cursor y cuerpo no permitido |

## Aceptación en pruebas: pendiente

Realizar con bases de pruebas y datos ficticios. Registrar fecha, responsable, evidencia y resultado en la tabla.

| ID | Escenario | Resultado esperado | Estado |
|---|---|---|---|
| A01 | Instalar Node y ODBC bajo cuenta de servicio | Driver disponible y DSN accesible | Pendiente |
| A02 | Consultar identidad ERP | Servicio/base/archivo coinciden con copia de pruebas validada | Pendiente |
| A03 | Cuenta Mongo fuente sin escritura | Puede leer/ping; integración funciona sin modificar CRM | Pendiente |
| A04 | Arrancar preview con lead elegible | Trabajo persistido y previewed; cero cambios ERP | Pendiente |
| A05 | Más de 100 leads | Ciclos cubren todas las páginas y vuelven al inicio | Pendiente |
| A06 | Reiniciar proceso | Cola se conserva; no se confirma falso éxito | Pendiente |
| A07 | Segundo proceso con mismo hub | No corre como segundo worker activo | Pendiente |
| A08 | Exceder relaciones/tamaño | Error 422 o rechazo contado; no truncamiento | Pendiente |
| A09 | Dos apps, claves diferentes | Ninguna clave consulta/captura la otra | Pendiente |
| A10 | Datos inválidos de negocio | Mapeo los rechaza sin escrituras parciales | Pendiente |
| A11 | Entrega live de prueba | Crea/actualiza entidad y devuelve erp_id correcto | Pendiente |
| A12 | Repetir misma revisión | No duplica prospecto, cliente ni seguimiento | Pendiente |
| A13 | Respuesta perdida tras commit ERP | Reintento devuelve resultado original | Pendiente |
| A14 | Mongo falla tras commit ERP | Reanudación no duplica datos | Pendiente |
| A15 | Timeout/lease vencido | Se verifica comportamiento real del driver y deduplicación ERP | Pendiente |
| A16 | Lead cambia durante envío | Se define reconciliación y resultado aceptable | Pendiente |
| A17 | Secuencia A → B → A | Resolver límite de clave por hash antes de live si debe reaplicar A | Pendiente |
| A18 | Reiniciar VM | Servicio arranca sin sesión y observa red/lease | Pendiente |
| A19 | Acceso remoto HTTPS | Certificado válido, token solo en backend y red autorizada | Pendiente |
| A20 | Restaurar hub/ERP | Reconciliación sin duplicados ni pérdida de correspondencias | Pendiente |

## Condiciones para considerar terminada la integración

No basta una respuesta `Connected` de DBeaver ni 202 de la API. Se requiere identidad aislada de pruebas, mapeo y procedimiento implementados, casos relevantes anteriores aprobados, carga esperada medida, respaldo/recuperación probados y operación asignada a responsables.

Cambios de etapa muy breves, historial de eventos, A → B → A, actualizaciones concurrentes y bajas deben tener una decisión explícita de negocio. Si se necesitan garantías más fuertes, modificar el diseño antes de activar escrituras.

## Registro de validación

```text
Versión de servicio / commit:
Fecha y responsable:
Ambiente / VM:
Node y arquitectura:
Driver SQL Anywhere y arquitectura:
Identidad ERP verificada (sin credenciales):
Base Mongo origen / hub (sin URI con secretos):
Casos ejecutados y evidencia:
Incidencias pendientes:
Aprobación funcional y de TI:
```
