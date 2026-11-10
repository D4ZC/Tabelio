# Runbook del MVP 6 — aceptación y preparación de lanzamiento

## Alcance

El MVP 6 certifica funcionalmente el producto sin desplegarlo. El resultado de un ciclo puede ser `GO` o `NO_GO`, pero `deploymentExecuted` permanece siempre en `false`: no se crean dominios, servidores, cuentas externas ni tráfico de producción.

La organización activa continúa siendo la frontera de seguridad. Cada ciclo conserva sus propios casos UAT, integraciones, controles, fotografías de métricas y decisión. Después de decidirlo queda inmutable y el siguiente ciclo empieza sin reutilizar evidencia.

## Responsables y permisos

| Rol | Alcance |
| --- | --- |
| Administración | Configura, ejecuta UAT, prueba adaptadores, completa controles, captura métricas, decide y exporta. |
| Jurídico | Consulta el ciclo y su evidencia. No puede modificar, decidir ni exportar. |
| Operación | Participa en las pruebas asignadas fuera del centro administrativo. |

## Compuertas obligatorias

Un ciclo sólo puede pasar de `Borrador` a `En decisión` cuando:

1. PostgreSQL y almacenamiento pasan las pruebas activas del ambiente;
2. existe al menos un caso aprobado en cada categoría UAT: funcional, jurídica, operación, seguridad y continuidad;
3. OCR, firma, correo, calendario y recuperación están simulados localmente o verificados externamente;
4. los seis controles de cumplimiento tienen evidencia;
5. una fotografía del último piloto completado conserva cero bloqueos.

La decisión `GO` vuelve a calcular todas las compuertas. `NO_GO` conserva igualmente una fotografía inmutable y una justificación.

## 6.1 Ambiente verificable

`Lanzamiento → Ambiente verificable` consulta PostgreSQL y realiza escritura, lectura y borrado en el almacenamiento. También muestra el alcance, HTTPS/cookie, recuperación y trazabilidad HTTP.

En `LOCAL`, HTTP y el adaptador local aparecen como advertencias no bloqueantes. En `STAGING` o `PRODUCTION` se vuelven bloqueantes si faltan `NODE_ENV=production`, HTTPS, cookie segura o un adaptador externo de recuperación. Cambiar el objetivo no ejecuta un despliegue.

## 6.2 Aceptación del cliente

Cada ciclo nace con cinco casos mínimos. Para aprobar un caso se exige:

- resultado observado;
- evidencia reproducible;
- revisor y fecha;
- categoría y resultado esperado.

Se pueden agregar casos adicionales, asociarlos a un expediente y asignarlos a una membresía operativa. Los identificadores de otra organización son rechazados.

## 6.3 Integraciones preparadas

Los cinco puertos se prueban con simuladores locales deterministas:

| Puerto | Prueba local |
| --- | --- |
| OCR | Captura manual y contrato de lectura opcional de INE con proveedor simulado; persistencia y revisión humana. La compatibilidad con el proveedor real requiere una prueba separada. |
| Firma | Solicitud manual, evidencia firmada y persistencia. |
| Correo | Contrato de salida e idempotencia, sin enviar mensajes. |
| Calendario | Recordatorios internos, sin crear eventos externos. |
| Recuperación | Token de un solo uso mediante el adaptador local configurado. |

`SIMULATED` es aceptable únicamente para `LOCAL`. Un ambiente remoto requiere `VERIFIED`, proveedor identificado y evidencia; el sistema nunca contacta un proveedor desde esta pantalla.

## 6.4 Seguridad y cumplimiento

Los controles predeterminados son: aviso de privacidad, retención/eliminación, revisión de accesos, respuesta a incidentes, simulacro de restauración e inventario de datos. Cada confirmación guarda evidencia, actor y fecha; una reapertura exige motivo y queda auditada.

Estas confirmaciones registran la revisión operativa, pero no sustituyen dictámenes jurídicos ni políticas firmadas por el cliente.

## 6.5 Métricas del piloto

La captura usa el último ciclo de piloto `COMPLETED` y verifica:

- despliegue simulado al 100%;
- al menos dos participantes capacitados;
- muestra objetivo conciliada;
- cero incidencias altas o críticas abiertas.

También conserva conteos de expedientes, documentos y tareas. Métricas y compuertas se serializan con SHA-256 para detectar alteraciones.

## 6.6 Decisión go/no-go

El flujo permitido es:

```text
Borrador → En decisión → GO
                       ↘ NO_GO
          ← reapertura motivada
```

Durante `En decisión` y después del fallo final no se pueden modificar casos, integraciones, controles ni métricas. La fotografía final incluye compuertas, ambiente, UAT, integraciones, cumplimiento, métricas y `deploymentExecuted: false`.

## Evidencia y verificación

```bash
npm run launch:check
```

El comando aplica migraciones, ejecuta pruebas, lint y builds, comprueba `health/ready` y recorre el smoke integral. El smoke prueba permisos jurídico/administración, resultado bloqueado y listo, cinco adaptadores, seis controles, métricas, GO, inmutabilidad, CSV, auditoría y aislamiento con una segunda organización.

Para el simulacro de continuidad:

```bash
npm run pilot:backup
npm run pilot:verify-backup -- '/ruta/mostrada/por/el/respaldo'
```

## Qué permanece fuera de alcance

- despliegue o publicación de infraestructura;
- compra o conexión real de OCR/IA, firma, correo y calendario;
- tratamiento de datos reales sin autorización y políticas aprobadas;
- sustitución de la revisión humana o jurídica.
