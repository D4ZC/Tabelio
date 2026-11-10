# Runbook del MVP 5 — piloto y despliegue

## Objetivo y alcance

Este runbook convierte la preparación del piloto en una operación verificable de principio a fin. Cubre los subíndices 5.1–5.6 y conserva fuera de alcance, hasta seleccionar proveedor, firma electrónica, correo y calendario externos. La extracción documental es manual por defecto; la lectura opcional de INE con IA se configura según `docs/EXTRACCION_INE.md` y requiere validar el proveedor. Toda incorporación de datos exige revisión humana.

La organización es siempre la frontera de seguridad. Cada ciclo del piloto tiene datos, participantes, conciliaciones, incidencias e importaciones propios. Al cerrarlo queda inmutable en el historial y sólo administración puede iniciar el siguiente ciclo.

## Responsables

| Función | Responsabilidad |
| --- | --- |
| Administración | Configurar el ciclo, importar, administrar cohorte, resolver incidencias, cambiar estado, exportar evidencia y autorizar despliegue. |
| Jurídico | Consultar preparación y operación; participar en capacitación y conciliación. No puede cambiar ni exportar controles del piloto. |
| Operación | Participar en la cohorte y ejecutar casos asignados; no administra la salida. |
| Infraestructura | Custodiar secretos, TLS, PostgreSQL, almacenamiento, respaldos, restauración y monitoreo de salud. |

## Compuertas obligatorias

El sistema no permite marcar el programa listo, activarlo ni cerrarlo mientras alguna compuerta esté bloqueada:

1. al menos un lote de migración confirmado;
2. al menos dos participantes activos;
3. toda la cohorte activa con evidencia de capacitación;
4. la muestra objetivo completamente conciliada, sin pendientes ni diferencias;
5. ninguna incidencia alta o crítica abierta.

Además, el centro de preparación conserva cinco checkpoints auditados: muestra validada, capacitación, operación paralela, soporte y respaldo/restauración.

## 5.1 Migración controlada

1. Abrir `Piloto → Operación` y fijar nombre y tamaño de muestra antes de iniciar.
2. Preparar un lote JSON de hasta 500 personas. No incluir `organizationId`; se toma de la sesión.
3. Ejecutar la vista previa. El sistema normaliza RFC y correo, detecta duplicados en el lote y contra el directorio, y calcula SHA-256 del contenido. El checksum se deduplica dentro del ciclo actual; un ciclo posterior vuelve a validar el mismo origen contra el estado vigente sin reutilizar lotes históricos.
4. Corregir o cancelar lotes bloqueados con motivo. No se crean personas durante la vista previa.
5. Confirmar únicamente un lote `READY`. La importación es transaccional: se crean todas las filas o ninguna, se guardan los identificadores y queda auditoría.
6. Guardar el CSV de operación como evidencia.

Las importaciones se cierran al iniciar el piloto. Un lote confirmado no se puede cancelar ni volver a importar silenciosamente.

## 5.2 Cohorte reducida y capacitación

1. Agregar al menos dos membresías activas con rol administrador, jurídico u operador.
2. Registrar evidencia individual de capacitación de al menos diez caracteres: sesión, fecha, ejercicio o material cubierto.
3. Retirar participantes sólo con motivo. Durante un piloto activo deben permanecer al menos dos.
4. Confirmar que la compuerta `Cohorte reducida` y la de `Capacitación` estén en verde.

## 5.3 Operación paralela

1. Seleccionar expedientes reales y, si existe, registrar la referencia del proceso anterior.
2. Ejecutar cada caso tanto en la plataforma como en el proceso vigente.
3. Registrar `Coincide` o `Diferencia` con una conclusión explícita.
4. Corregir toda diferencia y volver a documentar el resultado. La muestra sólo pasa cuando alcanza el objetivo, no tiene pendientes y no conserva diferencias.

## 5.4 Incidencias y correcciones

1. Registrar categoría, severidad, título, descripción, responsable y expediente cuando aplique.
2. Tratar incidencias altas y críticas como bloqueantes de salida.
3. Documentar una resolución reproducible antes de marcar `RESOLVED` o `CLOSED`.
4. Volver a ejecutar el escenario afectado y conservar la evidencia en el expediente o comentario de resolución.
5. Usar el CSV y la auditoría para la reunión diaria del piloto.

## 5.5 Respaldo, restauración y endurecimiento

### Verificación previa

```bash
npm run db:deploy
npm test
npm run lint
npm run build
curl --fail http://localhost:4000/api/health/live
curl --fail http://localhost:4000/api/health/ready
```

`live` confirma que el proceso responde. `ready` prueba PostgreSQL y realiza escritura, lectura y borrado sobre el almacenamiento configurado. La API agrega identificador de petición y encabezados defensivos; los contenedores ejecutan como usuario sin privilegios y aceptan apagado ordenado.

### Respaldo completo

```bash
npm run pilot:backup
```

El resultado contiene `database.dump`, `object-storage.tar.gz` cuando se usa almacenamiento local, `backup-metadata.json` y `manifest.sha256`. Para S3, el respaldo/versionado del bucket se configura en el proveedor y se documenta junto al dump.

### Restauración aislada

```bash
npm run pilot:verify-backup -- '/ruta/al/respaldo'
```

La verificación valida checksums, abre el archivo de objetos, crea una base temporal, restaura con `--exit-on-error`, cuenta organizaciones/expedientes/documentos y escribe `verification.json`; después elimina la base temporal. Sólo se marca el checkpoint de respaldo cuando `checksumVerified`, `databaseRestoreVerified` y, para almacenamiento local, `objectArchiveVerified` sean `true`.

### Secretos y despliegue

1. Copiar `.env.pilot.example` a `.env.pilot` y reemplazar todos los valores `CHANGE_ME`.
2. Usar HTTPS en `WEB_ORIGIN`, cookie segura y JWT aleatorio de 32 o más caracteres. Mantener recuperación `disabled` hasta conectar un proveedor real; nunca usar el enlace local en producción remota.
3. Configurar S3-compatible real y política de respaldo/versionado.
4. Terminar TLS en un proxy inverso y no publicar PostgreSQL.
5. Ejecutar `npm run pilot:deploy`; el script detecta Podman o Docker, construye, crea un respaldo previo, aplica migraciones, levanta API/web y espera que `health/ready` confirme PostgreSQL y almacenamiento. Rechaza secretos de ejemplo y falla si el ambiente no queda listo.

## 5.6 Despliegue gradual

El único recorrido permitido es:

```text
Borrador → Listo → 10% → 25% → 50% → 100% → Completado
                         ↕ pausa/reanudación en el mismo porcentaje
```

- El primer escalón siempre es 10%.
- No se puede omitir un escalón, reducir el porcentaje ni ampliarlo mientras el programa está pausado.
- Cualquier riesgo puede pausar el piloto; la reanudación conserva el porcentaje.
- El cierre exige 100% y todas las compuertas superadas.
- Un programa completado queda en el historial. El siguiente ciclo empieza en borrador, sin reutilizar participantes, lotes, conciliaciones ni incidencias anteriores.

## Reversión y respuesta a incidentes

1. Pausar el programa para detener la ampliación; no reducir porcentajes ni borrar evidencia.
2. Registrar la incidencia con severidad, responsable y expediente.
3. Si el servicio no está listo, retirar tráfico en el proxy y conservar API/base para diagnóstico.
4. Restaurar el último respaldo verificado en una base nueva; nunca sobrescribir primero la base afectada.
5. Comparar conteos, ejecutar `health/ready` y el smoke antes de cambiar la conexión.
6. Documentar resolución y reanudar en el mismo porcentaje. La ampliación sólo continúa después de superar otra vez las compuertas.

## Evidencia de aceptación

```bash
npm run pilot:check
```

El smoke verifica permisos, encabezados defensivos, migración con vista previa/cancelación/confirmación, cohorte, capacitación, conciliación, incidencia bloqueante y resolución, pausa, escalones 10/25/50/100, cierre, CSV, auditoría e historial de ciclos. También crea una segunda organización y demuestra que no puede leer ni modificar participantes, expedientes, incidencias o lotes de la primera. La evidencia de respaldo se encuentra en el `verification.json` generado por la restauración aislada.
