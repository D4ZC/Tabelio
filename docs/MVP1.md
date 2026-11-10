# MVP 1 — Núcleo operativo de expedientes

## Resultado buscado

Operar un arrendamiento y su posible convenio desde una sola fuente de datos, sin generación automática ni IA, evitando recapturas y haciendo visibles los requisitos faltantes.

## Alcance implementado

1. Organización, usuario, membresía y rol.
2. Personas físicas o morales con generales, RFC, domicilio e identificación.
3. Inmuebles principales y bienes ofrecidos en garantía.
4. Expediente de arrendamiento o convenio de mediación relacionado.
5. Participantes con roles jurídicos.
6. Condiciones de renta, depósito, pago, vigencia, mora y terminación.
7. Datos de convenio, expediente, audiencia, centro y facilitador.
8. Catálogo configurable de requisitos, snapshot por expediente y bloqueo antes de pasar a elaboración.
9. Repositorio documental desacoplado: disco local para desarrollo y adaptador S3-compatible para producción.
10. Estados controlados y bitácora de auditoría.
11. Permisos por rol para lectura, captura, transiciones y dispensas.
12. Versionado documental y enlaces de descarga temporales.
13. Administración local de integrantes y roles, con protección del último administrador.
14. Detección de duplicados por RFC, correo o domicilio del inmueble.
15. Edición auditada de personas e inmuebles.
16. Comparación textual por párrafos entre versiones DOCX consecutivas.
17. Revisión jurídica, solicitud de cambios y aprobación final con historial inmutable.
18. Separación de permisos entre revisión jurídica y autorización administrativa.
19. Solicitudes de firma asociadas a la versión aprobada, con cancelación motivada.
20. Carga versionada del contrato firmado y activación transaccional del expediente.
21. Alertas derivadas de vencimiento en ventanas de 90, 60, 30 y 15 días.
22. Tablero operativo de contratos activos, integración y riesgo de vencimiento.
23. Creación auditada de renovaciones relacionadas, sin recaptura de datos base.
24. Terminación cancelable con restauración segura del estado anterior.
25. Cierre condicionado a evidencia documental versionada.
26. Métricas operativas de revisión, firma, activación, terminación y cierre.
27. Recordatorios internos persistentes 90/60/30/15 con deduplicación y reconocimiento auditado.
28. Preparación de canales de correo y calendario sin declarar envíos externos inexistentes.
29. Recuperación y cambio de contraseña mediante tokens de un solo uso almacenados como hash.
30. Revocación de sesiones anteriores y validación activa de membresía en cada petición.
31. Bloqueo temporal y auditado después de cinco intentos fallidos de inicio de sesión.
32. Catálogo multitenant de cláusulas con versiones inmutables y aprobación separada.
33. Selección por expediente y snapshot exacto de cláusulas en cada documento generado.
34. Conversión DOCX a PDF mediante puerto reemplazable, con versión, checksum y vínculo al origen.
35. Vista previa autenticada y requisito de PDF vigente antes de revisión o firma.
36. Portal externo por invitación, con captura, archivos, revisión humana y promoción controlada.
37. Tareas manuales y automáticas con responsables, SLA, estados y tablero de carga.
38. Reportes operativos por periodo, riesgo, cuellos de botella y exportación CSV segura.
39. Requisitos por organización y tipo de expediente, con orden, rol, activación y confirmación manual.
40. Buscador global de expedientes, personas, inmuebles y documentos con resultados relacionados.
41. Centro de auditoría administrativa con filtros, paginación y exportación CSV segura.
42. Control de vigencia documental con alertas 90/30/15 y efecto automático sobre el checklist.
43. Carga múltiple clasificada por archivo, con resultados parciales, versionado y auditoría individual.
44. Motor explicable de advertencias de consistencia no bloqueantes, sin IA.
45. Corrección auditada de clasificación documental con versionado determinista.
46. Semáforo operativo explicable derivado de checklist y advertencias.
47. Invalidación y restauración documental auditada, sin borrado físico y con exclusión de cálculos operativos.
48. Cancelación controlada del expediente con propagación transaccional a tareas, portal y firma pendiente.
49. Prevención de archivos duplicados por checksum en cargas internas, externas y evidencias controladas.
50. Versiones documentales operativas por persona, inmueble o tipo, con historial descargable y reversión automática.
51. Tareas automáticas de renovación documental con prioridad, responsable, deduplicación y cierre por evidencia.
52. Responsable operativo por expediente, con reasignación auditada y propagación selectiva a automatizaciones abiertas.
53. Escalación de SLA en dos niveles, con aumento de prioridad, auditoría e idempotencia.
54. Bandeja personal de avisos para asignaciones y escalaciones, con reconocimiento y cancelación por ciclo de vida.
55. Bloqueo motivado de tareas con autor, antigüedad, resolución auditada y reporte de cuellos de botella.
56. Reprogramación motivada de tareas manuales con historial inmutable y reinicio controlado de escalaciones SLA.
57. Notas inmutables de seguimiento por tarea con autor, fecha y evento de auditoría.
58. Avisos internos por nuevas notas dirigidos al responsable, sin notificar al propio autor.
59. Búsqueda y filtros combinables de tareas por texto, estado, prioridad y responsable.
60. Exportación CSV segura de tareas con filtros activos, límite operativo y permiso restringido.
61. Filtros temporales de tareas vencidas, del día, de próximos siete días y sin fecha límite.
62. Evidencia documental obligatoria por tarea, con vínculo inmutable, validación operativa y descarga desde el contexto de trabajo.
63. Prerrequisitos acíclicos entre tareas manuales del mismo expediente, editables antes de iniciar y obligatorios para avanzar.
64. Extracciones documentales versionadas con candidatos, confianza/procedencia, bandeja y revisión humana inmutable antes de persistir datos.
65. Centro de preparación para piloto con diagnóstico técnico, checkpoints operativos auditados, permisos separados y exportación CSV.

## Reglas obtenidas de las plantillas

### Arrendamiento

- Requiere arrendador, arrendatario y obligado solidario.
- Requiere inmueble arrendado, uso, domicilio y acreditación de propiedad.
- Controla renta, mantenimiento, forma de pago, depósito y renta anticipada.
- Controla inicio, fin, duración, aviso previo, mora, sobreprecio por ocupación posterior y pena por terminación anticipada.
- Permite registrar un inmueble adicional ofrecido en garantía.
- Requiere identificaciones y evidencia documental de propiedad.

### Convenio

- Debe relacionarse con el contrato de arrendamiento origen.
- Reutiliza partes, inmueble, renta y vigencia del arrendamiento.
- Añade número de convenio, número de expediente, fecha/hora, centro y persona facilitadora.
- Requiere el contrato de arrendamiento como Anexo 1.
- Conserva la distinción entre parte solicitante, parte complementaria y obligado solidario.

Fuentes de análisis: `Contrato Arrendamiento PLANTILLA.doc` y `Convenio PLANTILLA.doc`, conservadas sin modificación en la raíz del proyecto.

## Flujo del MVP

```text
Borrador → Integración → Validación → Listo para elaborar
```

El modelo ya contempla las etapas futuras de elaboración, revisión, aprobación, firma, vigencia, renovación, terminación y cierre. En este MVP sólo se habilita el avance con requisitos bloqueantes completos.

## Multitenencia

- `Organization` es la frontera de datos.
- Cada agregado de negocio contiene `organizationId`.
- El token identifica la organización activa.
- Los identificadores enviados por el cliente siempre se vuelven a verificar contra esa organización.
- El almacenamiento usa prefijos `organización/expediente/archivo`.

Aunque inicialmente existe una sola organización, no será necesario rediseñar tablas para incorporar otras.

## Preparación para IA sin usar IA

`DocumentExtractionPort` define el contrato que deberá cumplir cualquier proveedor futuro. Cada solicitud crea una ejecución versionada que puede conservar datos crudos, candidatos por campo, confianza y procedencia. La implementación actual devuelve `MANUAL_REVIEW`; una persona debe confirmar, corregir o rechazar el resultado antes de que el documento reciba datos confirmados. Un proveedor futuro podrá aportar OCR o IA sin cambiar los módulos de expedientes ni retirar el control humano.

## Fuera de alcance del MVP 1

- Generación de Word/PDF.
- Corrección o parametrización visual de las plantillas.
- OCR o extracción automática.
- Firma electrónica.
- Correos, calendario y notificaciones externas.
- Autoservicio para crear expedientes completos sin intervención interna.
- Reportería avanzada.
- Definición final de proveedor cloud.

## Backlog siguiente

### MVP 1.1 — endurecimiento y piloto

- ✅ Edición y deduplicación de personas e inmuebles.
- ✅ Descarga segura y versionado de documentos.
- ✅ Excepciones o dispensa de checklist con motivo y autorización.
- ✅ Matriz de permisos por rol.
- ✅ Sesión web mediante cookie `HttpOnly`; tokens Bearer conservados para clientes de API.
- ✅ Migraciones versionadas y prueba integral local contra PostgreSQL y almacenamiento.
- ✅ Recuperación y cambio de contraseña con revocación de sesiones.

### MVP 2 — documentos jurídicos

- ✅ Primera versión de arrendamiento convertida a variables estables.
- ✅ Generación DOCX versionada, validada y sujeta a revisión jurídica.
- ✅ Corrección del bloque de firmas que dejaba una sexta página casi vacía.
- ✅ Conversión del convenio a 61 variables estables con concordancia gramatical.
- ✅ Generación DOCX del convenio desde el arrendamiento vinculado, con versionado, auditoría y revisión jurídica.
- ✅ Comparación textual del borrador vigente contra su versión anterior.
- ✅ Solicitud motivada de cambios y nueva versión obligatoria antes de reingresar a revisión.
- ✅ Aprobación jurídica y aprobación final con permisos separados, auditoría y avance automático de etapa.
- ✅ Catálogo de cláusulas, versiones, aprobación, selección y trazabilidad documental.
- ✅ Vista previa y generación PDF versionada desde el DOCX vigente.

### MVP 3 — activación y seguimiento

- ✅ Puerto de firma desacoplado con proveedor manual inicial.
- ✅ Solicitud, cancelación, evidencia firmada y activación controlada.
- ✅ Alertas de vencimiento 90/60/30/15 y tablero operativo.
- ✅ Expediente de renovación con partes, inmuebles y condiciones precargadas.
- ✅ Terminación motivada, cancelación y cierre con evidencia obligatoria.
- ✅ Métricas del pipeline y tiempo promedio hasta activación.
- ✅ Recordatorios persistentes, sincronización manual y reconocimiento auditado.
- ✅ Portal seguro para captura externa por expediente y rol, con aprobación interna.
- ⏸ Integración con proveedor externo de firma electrónica, diferida hasta seleccionar proveedor.
- ⏸ Proveedores de notificaciones por correo o calendario, diferidos hasta seleccionar proveedor.
- ✅ Renovación, convenio, terminación y cierre.
- ✅ Tablero operativo y métricas.
- ✅ Tareas por expediente, SLA y carga por responsable.
- ✅ Reporte operativo, cuellos de botella y exportación CSV.
- ✅ Catálogo configurable de requisitos y snapshot histórico del checklist.
- ✅ Búsqueda global multitenant con acceso directo al contexto encontrado.
- ✅ Consulta organizacional de auditoría y exportación restringida a administración.
- ✅ Repositorio central, fechas documentales y alertas de vencimiento sin proveedores externos.
- ✅ Carga múltiple de documentos con clasificación manual por archivo y recuperación de errores parciales.
- ✅ Advertencias deterministas de asociaciones, vigencias, roles, fechas e importes.
- ✅ Corrección de tipo, persona e inmueble sin modificar archivos de flujos controlados.
- ✅ Indicador rojo/amarillo/verde con motivos concretos y sin puntajes opacos.
- ✅ Invalidación documental reversible con preservación de archivo, checksum, versión, responsable e historial.
- ✅ Cancelación motivada del expediente, cierre coordinado del trabajo abierto y conservación integral de evidencia.
- ✅ Detección SHA-256 de archivos idénticos por expediente, sin IA y sin romper resultados parciales de lote.
- ✅ Separación de versiones operativas e históricas en vigencia, checklist, advertencias y búsqueda, sin borrar evidencia.
- ✅ Tareas de renovación para documentos vencidos o a 30 días, con cierre y reapertura ligados a la versión operativa.
- ✅ Responsable seleccionable por expediente y reasignación segura de tareas automáticas y recordatorios pendientes.
- ✅ Escalación interna de tareas vencidas a prioridad alta o urgente, con niveles visibles y sincronización idempotente.
- ✅ Avisos internos persistentes y deduplicados para expedientes, tareas y SLA, visibles sólo para su destinatario.
- ✅ Motivo obligatorio al bloquear tareas y visibilidad de bloqueos activos en tablero, expediente, reporte y CSV.
- ✅ Reprogramación motivada de tareas manuales con historial y reinicio de SLA.
- ✅ Notas inmutables para documentar avances y acuerdos dentro de cada tarea.
- ✅ Avisos personales cuando otro integrante agrega una nota a una tarea asignada.
- ✅ Bandeja de tareas con búsqueda multitenant y filtros combinables para reducir tiempo de localización.
- ✅ Exportación CSV de tareas filtradas, protegida contra fórmulas y restringida a perfiles autorizados.
- ✅ Segmentación temporal de la carga por vencimiento, combinable con búsqueda y exportación.
- ✅ Evidencia documental configurable en tareas, sin duplicar archivos y con bloqueo de cierre cuando falta un soporte operativo vigente.
- ✅ Dependencias entre tareas con prevención de ciclos, secuencia obligatoria y protección contra reapertura inconsistente.

### MVP 4 — automatización asistida

- ⏸ OCR de INE y comprobantes, diferido por decisión explícita; el puerto de proveedor ya existe.
- ✅ Ejecuciones de extracción versionadas con estado, proveedor, datos crudos y contrato para confianza/procedencia por campo.
- ✅ Bandeja multitenant de resultados pendientes y revisados, sin exposición de llaves de almacenamiento.
- ✅ Confirmación, corrección o rechazo humano inmutable con comentario, autor, fecha y auditoría.
- ✅ Persistencia de datos confirmados sólo después de revisión; el proveedor manual actual permanece activo.
- ⏸ Poblado automático de candidatos, confianza y procedencia, diferido hasta seleccionar proveedor OCR/IA.
- ⏸ Comparación de consistencia entre documentos y captura automática, pendiente del proveedor de extracción.

### MVP 5 — preparación del piloto

- ✅ Diagnóstico técnico por organización con bloqueantes, advertencias y controles superados.
- ✅ Validación de base, administrador activo, usuarios, almacenamiento, extracciones pendientes y tareas vencidas.
- ✅ Visibilidad explícita de extracción, firma y avisos externos que todavía usan adaptadores manuales.
- ✅ Checkpoints de muestra validada, capacitación, operación paralela, soporte y respaldo/restauración.
- ✅ Evidencia, responsable y fecha en cada confirmación, con reapertura motivada y auditoría.
- ✅ Lectura para perfil jurídico y administración exclusiva de cambios y exportación CSV.
- ✅ Pantalla de decisión “listo/no listo” y smoke repetible que recorre ambos estados.
- ✅ MVP 5.1: migración controlada con vista previa, validación por fila, checksum, cancelación y confirmación transaccional.
- ✅ MVP 5.2: cohorte reducida, roles operativos y evidencia individual de capacitación.
- ✅ MVP 5.3: operación paralela por expediente, referencia anterior y conciliación humana de la muestra objetivo.
- ✅ MVP 5.4: incidencias por severidad, responsable, resolución y bloqueo de salida para riesgos altos o críticos.
- ✅ MVP 5.5: configuración endurecida, salud live/ready, contenedores sin privilegios y respaldo/restauración verificable.
- ✅ MVP 5.6: despliegue obligatorio 10/25/50/100, pausa, cierre, CSV, auditoría e historial inmutable de ciclos.
- ⏸ Proveedores reales de OCR/IA, firma, correo y calendario, diferidos hasta seleccionarlos y contratarlos.

### MVP 6 — aceptación y preparación de lanzamiento local

- ✅ MVP 6.1: diagnóstico activo de PostgreSQL, almacenamiento, transporte, recuperación y trazabilidad por ambiente objetivo.
- ✅ MVP 6.2: UAT por categorías funcional, jurídica, operación, seguridad y continuidad, con evidencia y responsable.
- ✅ MVP 6.3: puertos de OCR, firma, correo, calendario y recuperación simulables localmente y verificables después con proveedor.
- ✅ MVP 6.4: controles auditados de privacidad, retención, accesos, incidentes, restauración e inventario de datos.
- ✅ MVP 6.5: fotografía SHA-256 de métricas y compuertas del último piloto completado.
- ✅ MVP 6.6: decisión GO/NO-GO, CSV, auditoría, historial inmutable y aislamiento multitenant.
- ✅ El snapshot final registra `deploymentExecuted: false`; el MVP 6 no despliega ni publica infraestructura.
- ⏸ Conexiones reales con proveedores y despliegue remoto permanecen diferidos por decisión del proyecto.

## Criterios de aceptación del MVP 1

- Un usuario sólo puede consultar datos de su organización.
- Se puede crear una persona, un inmueble y un expediente.
- El sistema crea automáticamente el checklist correcto.
- Una transición inválida es rechazada.
- No se puede marcar “listo para elaborar” con requisitos bloqueantes pendientes.
- Los documentos quedan asociados al expediente y registrados en auditoría.
- Cada carga del mismo tipo documental incrementa su versión.
- Las descargas usan enlaces temporales y vuelven a validar la organización.
- Las cargas están limitadas por tamaño y tipo documental permitido.
- Sólo perfiles jurídicos o administrativos pueden dispensar requisitos, siempre con motivo.
- Solicitar extracción no llama a IA y devuelve revisión manual.
- Las reglas puras cuentan con pruebas automatizadas.
