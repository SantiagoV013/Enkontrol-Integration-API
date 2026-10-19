# Instalación en Windows y máquina virtual

[Índice](README.md)

Esta guía prepara una instalación; no acredita que ya se haya desplegado. No incorpora contraseñas ni crea usuarios o reglas de firewall automáticamente.

## Requisitos a confirmar con TI

- Windows y arquitectura de la VM, memoria disponible, espacio y mecanismo de respaldo.
- Node.js 22 y npm. El paquete permite versiones mayores, pero la compatibilidad del driver nativo debe probarse en la versión elegida.
- Cliente/driver **SQL Anywhere**, compatible con el servidor 11.0.0.1264. No sustituir por Microsoft SQL Server.
- Driver ODBC de la misma arquitectura que Node. DBeaver usa JDBC: su prueba satisfactoria no acredita que ODBC esté instalado.
- Salida de red/DNS/TLS hacia los MongoDB configurados. Si se usa Atlas, autorizar la salida real de la VM conforme a su configuración de red.
- Cuenta de lectura para el CRM, cuenta de escritura limitada al hub y cuenta ERP dedicada.
- Acceso al ERP desde la VM. Si está en otro equipo, habilitar únicamente el origen de integración y puerto correspondiente.

## Instalación inicial

Copiar la carpeta completa del servicio, incluido `package-lock.json`, a `C:\EnkontrolIntegration`. No copiar `node_modules` de macOS a Windows.

```powershell
Set-Location C:\EnkontrolIntegration
node --version
npm --version
npm ci --omit=dev
Copy-Item .env.example .env
Copy-Item apps.example.json apps.local.json
```

Los dos últimos comandos son solo para una instalación nueva: no sobreescribir archivos configurados. Editarlos localmente con los valores correctos y restringir permisos de lectura a la cuenta de servicio y administradores autorizados.

`odbc` es dependencia opcional: npm puede finalizar aunque no se instale. Comprobar:

```powershell
npm ls odbc
```

Si falla, revisar el log de instalación y los requisitos de compilación de `node-odbc` para Windows. No continuar con live. Para desarrollo sin ERP se puede instalar con `npm ci --omit=optional`; eso no habilita `/erp/identity`.

## DSN de SQL Anywhere

Usar el administrador ODBC correspondiente a la arquitectura elegida y crear un **System DSN**, accesible por la cuenta de ejecución. Parámetros conocidos del entorno de pruebas:

| Dato | Valor observado / decisión |
|---|---|
| Motor | SQL Anywhere 11.0.0.1264 |
| Servidor físico observado | `192.168.0.111` |
| Puerto observado | `49158` |
| Nombre de servicio/servidor SQL | `test_ck` |
| Nombre interno de base | `EK_ADM01_11` |
| DSN propuesto | `EnkontrolTest` |
| Archivo de base | Pendiente de confirmar; no copiar una ruta truncada de captura |

Si SQL Anywhere corre en la **misma VM**, puede usarse loopback. Si está en otra VM o en el host físico, usar su dirección accesible. `127.0.0.1` nunca significa automáticamente “el host físico”. NAT, bridge o redes virtuales pueden cambiar rutas y reglas.

Ejemplo de conexión en `.env`, con placeholders:

```dotenv
EK_ODBC_CONNECTION_STRING="DSN=EnkontrolTest;UID=INTEGRATION_USER;PWD=REEMPLAZAR_LOCALMENTE"
```

Si la contraseña contiene delimitadores ODBC, construir la cadena con el escapado que requiera el driver. No pegarla en comandos compartidos, tickets ni logs.

## Primer arranque en preview

```powershell
Set-Location C:\EnkontrolIntegration
npm start
```

En otra consola:

```powershell
Invoke-RestMethod http://127.0.0.1:4080/health/live
```

Para las rutas autenticadas usar una clave cargada por el operador en el entorno de esa consola. `npm start` no exporta las variables del `.env` a otras consolas.

Verificar `/v1/apps/crm/status`, `/leads`, una vista previa y, con ODBC disponible, `/erp/identity`. Ver [pruebas de aceptación](testing.md). Que `/health/live` responda no garantiza que el sondeo, MongoDB o Enkontrol funcionen.

## Arranque automático

La entrega es una aplicación Node, no un instalador de Windows Service. Opción documentada: tarea del Programador de tareas al iniciar el equipo.

| Propiedad | Configuración |
|---|---|
| Cuenta | Cuenta de servicio acordada con TI; permisos mínimos |
| Ejecución | Aunque el usuario no haya iniciado sesión |
| Programa | Ruta absoluta de `node.exe` instalada en la VM |
| Argumentos | `--env-file=C:\EnkontrolIntegration\.env C:\EnkontrolIntegration\src\main.mjs` |
| Iniciar en | `C:\EnkontrolIntegration` |
| Disparador | Inicio del equipo; retraso si necesita esperar red |
| Fallo | Reintento controlado; tener en cuenta lease de cinco minutos |
| Instancia existente | No iniciar otra instancia |

Configurar captura/rotación de stdout y stderr mediante el supervisor elegido por TI. La aplicación no instala un recolector de logs. Si se prefiere Windows Service, usar un supervisor aprobado y probar su cierre: detener un proceso de Windows no siempre entrega SIGTERM.

## HTTPS y acceso de aplicaciones

Mantener `HOST=127.0.0.1` y colocar un proxy TLS administrado delante. TI debe configurar dominio, certificado, reglas de acceso y tiempo de espera superior al de las operaciones esperadas. No se incluye configuración específica de IIS porque no se ha confirmado su instalación ni módulos.

El puerto SQL no debe convertirse en la API pública. Para consumo desde Next.js desplegado fuera de la oficina, debe existir una ruta autorizada hacia HTTPS de la API. Para el sondeo automático bastan las conexiones salientes de la VM hacia MongoDB.

## Traslado físico → VM

1. Detener la instancia anterior del servicio de integración.
2. Confirmar qué archivo/base ERP se restauró en la VM y su aislamiento de pruebas.
3. Actualizar DSN, host, puerto, nombres esperados y archivo exacto si cambiaron.
4. Mantener la base hub si se desea conservar progreso y relaciones; respaldarla antes.
5. Confirmar IP de salida a MongoDB, permisos y DNS del proxy.
6. Arrancar en preview y repetir aceptación. No ejecutar a la vez la instancia antigua y la nueva.

## Actualización y reversión

Detener, respaldar configuración y hub, guardar versión anterior, instalar la nueva con `npm ci`, probar en preview y verificar logs/cola. Una reversión del código no revierte registros ya creados en ERP. Conservar `erpId` y las claves de idempotencia para reconciliación.
