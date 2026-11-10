# Tabelio — MVP 6

## Acceso móvil local con QR

La navegación móvil prioriza `/asistente`. Desde el menú del escritorio, **Llévalo en tu móvil** genera un QR en esta computadora con su IP de red y el puerto actual. Conecta el teléfono a la misma red Wi-Fi, escanea e inicia sesión con tu cuenta habitual. La computadora debe permanecer encendida y el firewall debe permitir el puerto web `3000`. El QR sólo contiene la dirección de la app; cada teléfono conserva su propia sesión autenticada.

Las peticiones al backend local pasan por `/api` en el mismo origen web, conservando cookies, documentos y adjuntos sin que el teléfono intente contactar su propio `localhost`. `API_PROXY_TARGET` configura el destino privado (por defecto `http://127.0.0.1:4000/api`; en Docker, `http://api:4000/api`). Las URLs remotas explícitas de `NEXT_PUBLIC_API_URL` conservan su comportamiento. Después de cambiar la configuración de Next, reinicia el servidor web; en producción, reconstruye la app.

El chat y el presupuesto funcionan por HTTP local. **El micrófono en un teléfono requiere HTTPS confiable y un navegador compatible con reconocimiento de voz.** Para prepararlo sin publicar la app en Internet:

1. Ejecuta `npm run mobile:setup`. Usa OpenSSL para generar una autoridad local y un certificado HTTPS para `localhost` y las IP privadas actuales. Los archivos quedan en `.certificates/`, excluidos de Git y Docker.
2. Transfiere únicamente `.certificates/Expediente-Local-CA.cer` a tu teléfono, por ejemplo con AirDrop. En iPhone, instala el perfil y activa **Ajustes → General → Información → Ajustes de confianza de certificados**. En Android, instala el certificado de CA desde **Seguridad → Cifrado y credenciales**; la ruta puede variar por fabricante. Si accedes por HTTPS desde la computadora, importa también el certificado público como autoridad de confianza en su sistema o navegador.
3. Detén los servidores previos de los puertos `3000` y `4000` e inicia `npm run dev:mobile`. Prepara la base de datos e inicia API `4000`, escritorio HTTP `3000` y un proxy HTTPS móvil `3443` con streaming de adjuntos y WebSocket para recarga del navegador. Si API y web ya están encendidas, ejecuta sólo `npm run mobile:serve` para añadir HTTPS sin reiniciarlas.
4. Abre `http://localhost:3000`, inicia sesión y escanea el nuevo QR: mientras el proxy esté activo, apunta a `https://IP-DE-LA-COMPUTADORA:3443/asistente`. El menú **Instalar certificado** ofrece un segundo QR para descargar únicamente el certificado público a través de HTTP local, antes de usar HTTPS. Permite el micrófono en el teléfono. Aceptar una advertencia de certificado por sí solo no garantiza que el navegador habilite el dictado: el certificado debe ser de confianza.

Si cambia la IP del Wi-Fi, repite `npm run mobile:setup` y reinicia el proxy HTTPS. La CA local permanece igual mientras existan sus archivos. Sus llaves privadas (`*-key.pem`) permanecen en la computadora. El certificado del servidor vence a los 90 días y la CA al año; después del vencimiento de la CA, elimina `.certificates/`, genera una nueva e instala su certificado público en los dispositivos. Permite los puertos `3000` y `3443` en el firewall local. Las cookies locales siguen disponibles por HTTP para que el conector IBM del escritorio conserve su origen habitual; esta configuración está destinada al desarrollo en una red local de confianza.

El conector IBM W3 en vivo funciona en el escritorio compatible (`http://localhost:3000`). El teléfono puede consultar el último saldo compartido desde ese escritorio por la misma cuenta y organización, identificado con su hora de actualización. La copia se conserva en memoria hasta ocho horas y se pierde al reiniciar la API; el saldo remoto en vivo desde móvil requiere la configuración de presupuesto del backend. El consumo local registrado y los detalles de la conversación mantienen su acceso sin la extensión.

Primera rebanada vertical de la plataforma de gestión contractual inmobiliaria. Incluye:

- autenticación local y membresías por organización;
- administración de integrantes y roles;
- aislamiento multitenant desde el modelo de datos y las consultas;
- directorio reutilizable de personas e inmuebles;
- expedientes de arrendamiento y convenios relacionados;
- condiciones económicas, vigencia y datos de mediación;
- catálogo multitenant de requisitos y checklist derivado de las plantillas reales;
- requisitos automáticos o de confirmación manual, con orden, rol aplicable, bloqueo y vigencia configurables;
- snapshot histórico del checklist para que los cambios del catálogo no alteren expedientes existentes;
- workflow con transiciones controladas;
- carga documental mediante disco local en desarrollo y un adaptador S3-compatible para producción;
- bitácora de auditoría;
- permisos por rol, dispensas motivadas y versionado documental;
- descargas autenticadas desde el proveedor configurado;
- extracción documental manual, lectura local de PDF/OCR y lectura opcional con IA, siempre con revisión humana antes de aplicar datos.
- resumen del expediente, inconsistencias, clasificación documental y comparación explicada, con selector local/IA y registro de consumo; consulta [Análisis local y con IA](docs/ANALISIS_LOCAL_IA.md).
- tutorial interactivo en `/tutorial`, con demostración automática, práctica, cursor visible, controles y progreso por cuenta; consulta [Tutorial para clientes](docs/TUTORIAL_INTERACTIVO.md).
- generación versionada de contratos de arrendamiento y convenios DOCX mediante plantillas jurídicas v1;
- revisión jurídica y aprobación final con comentarios obligatorios, historial inmutable y permisos separados;
- comparación textual entre la versión vigente y la anterior, por párrafos.
- solicitud de firma desacoplada mediante un puerto de proveedor, con implementación manual inicial;
- carga controlada de la copia firmada, evidencia temporal y activación automática del expediente.
- tablero operativo con ventanas de vencimiento a 90, 60, 30 y 15 días;
- expedientes de renovación relacionados, con reutilización de partes, inmuebles y condiciones.
- terminación cancelable y cierre controlado mediante evidencia documental;
- métricas de revisión, firma, activación, terminación y cierre.
- recordatorios persistentes de renovación a 90, 60, 30 y 15 días, con reconocimiento auditado;
- canales preparados para correo y calendario, sin simular envíos mientras no exista un proveedor configurado.
- recuperación y cambio de contraseña con enlaces de un solo uso y vigencia de 30 minutos;
- invalidación inmediata de sesiones después de cambiar credenciales, desactivar usuarios o retirar membresías.
- bloqueo temporal de 15 minutos después de cinco intentos consecutivos fallidos de acceso.
- catálogo multitenant de cláusulas con borradores, versiones y aprobación administrativa;
- selección de cláusulas por expediente e inserción automática antes del bloque de firmas;
- copia inmutable de cada cláusula y versión utilizada dentro del registro del DOCX generado.
- conversión desacoplada de DOCX a PDF mediante LibreOffice, con versión, checksum y documento origen;
- vista previa PDF autenticada dentro del expediente y bloqueo de revisión mientras falte el PDF vigente;
- solicitudes de firma ligadas al PDF aprobado, conservando el DOCX jurídico como fuente.
- portal externo por invitación para capturar datos y documentos sin una cuenta interna;
- tokens de portal almacenados sólo como hash, con vencimiento, revocación y enlace visible una sola vez;
- bandeja de revisión que mantiene la captura externa separada hasta que el despacho la acepta;
- incorporación auditada de la persona, su rol y sus documentos, con posibilidad de solicitar correcciones.
- tareas operativas por expediente con responsable, prioridad, fecha límite y estados auditados;
- tablero de carga por responsable, vencimientos, próximos siete días y trabajo asignado al usuario;
- creación automática de una tarea con SLA de dos días cuando el portal recibe una captura, y cierre al revisarla.
- reporte operativo por periodo con productividad, tiempos de ciclo, pipeline, tareas/SLA y carga por responsable;
- detección de expedientes sin actividad y contratos dentro de ventanas de riesgo de renovación;
- exportación CSV protegida contra fórmulas, reservada a perfiles administrativos y jurídicos.
- búsqueda global multitenant por referencia, nombre, RFC, contacto, domicilio, referencia registral o archivo;
- resultados agrupados de expedientes, personas, inmuebles y documentos, con acceso directo al contexto relacionado.
- centro administrativo de auditoría con filtros por periodo, acción, entidad, responsable y expediente;
- exportación CSV de la bitácora, paginación y separación entre acciones humanas y automatizaciones.
- repositorio documental central con fechas de emisión, vencimiento, filtros y edición auditada;
- ventanas documentales de 90, 30 y 15 días, documentos vencidos y archivos sin fecha;
- checklist automático sensible a vigencia: una evidencia vencida deja de satisfacer su requisito.
- carga múltiple de hasta 10 archivos, con tipo, persona, inmueble y vigencia definidos por archivo;
- resultados parciales: cada archivo correcto conserva versión y auditoría aunque otro falle.
- eliminación confirmada de cargas incorrectas, con motivo, auditoría y protección de contratos y evidencias vinculadas.
- motor de advertencias no bloqueantes para asociaciones documentales, vigencias, roles, fechas e importes;
- recomendaciones explicables y calculadas con reglas deterministas, sin IA.
- corrección auditada de tipo, persona e inmueble para documentos cargados manualmente;
- reasignación determinista de versión al reclasificar, sin alterar el archivo ni su checksum.
- semáforo operativo rojo/amarillo/verde derivado del checklist y las advertencias;
- motivos explicables sin puntajes arbitrarios ni decisiones generadas por IA.
- invalidación documental reversible con motivo, responsable y auditoría;
- exclusión de archivos invalidados del checklist, vigencia, búsqueda y advertencias, conservando descarga e historial.
- cancelación controlada de expedientes con motivo, responsable y fecha obligatorios;
- cierre transaccional de tareas, invitaciones de portal y solicitudes de firma pendientes al cancelar.
- detección de archivos idénticos mediante SHA-256 dentro de cada expediente;
- rechazo de duplicados en carga interna, lotes parciales, portal, firma y evidencia de terminación.
- separación entre versión documental operativa e historial descargable por persona, inmueble o tipo jurídico;
- exclusión de versiones superadas en vigencia, checklist, advertencias y búsqueda, con reversión automática al invalidar la vigente.
- tareas automáticas para documentos vencidos o dentro de 30 días, asignadas al responsable del expediente;
- prioridad por riesgo, cierre al renovar, reapertura al restaurar una versión anterior y sincronización idempotente.
- responsable operativo seleccionable al crear el expediente y reasignable durante su operación;
- propagación auditada del nuevo responsable a tareas automáticas abiertas y recordatorios pendientes, sin alterar tareas manuales.
- escalación interna de SLA en dos niveles: prioridad alta al vencer y urgente desde el tercer día de atraso;
- sincronización idempotente y auditada de escalaciones, con visibilidad en tablero, carga por responsable y cada tarea.
- bandeja personal de avisos internos para expedientes asignados, tareas asignadas y escalaciones de SLA;
- reconocimiento auditado, deduplicación por evento y cancelación automática cuando el trabajo concluye.
- bloqueo de tareas con motivo obligatorio, autor, fecha y conservación del motivo resuelto en auditoría;
- tablero y reporte de cuellos de botella con bloqueos activos, responsable y antigüedad.
- reprogramación motivada exclusiva para tareas manuales, con historial inmutable de fechas y responsables;
- reinicio de la escalación SLA y cancelación de avisos de escalación activos al acordar una nueva fecha.
- notas inmutables de seguimiento dentro de cada tarea, con autor, fecha y auditoría organizacional.
- avisos personales al responsable cuando otro integrante agrega una nota, sin generar ruido al propio autor.
- búsqueda de tareas por título, descripción, expediente o referencia, combinable con estado, prioridad y responsable.
- exportación CSV segura de la bandeja de tareas respetando filtros y permisos de reporte.
- filtros temporales para tareas vencidas, del día, de próximos siete días o sin fecha límite.
- evidencia documental configurable por tarea, vinculada sin duplicar archivos y con cierre bloqueado mientras no exista una versión vigente del mismo expediente.
- prerrequisitos entre tareas manuales del mismo expediente, con prevención de ciclos y bloqueo de inicio o cierre hasta completar la secuencia.
- ejecuciones versionadas de extracción con proveedor, estado, datos crudos, candidatos por campo, confianza y procedencia preparados para un proveedor futuro;
- bandeja de revisión humana para confirmar, corregir o rechazar resultados antes de persistir datos confirmados en el documento.
- centro de preparación para piloto con diagnóstico técnico multitenant, bloqueantes y advertencias explicables;
- cinco checkpoints operativos con evidencia, responsable, fecha, reapertura motivada y auditoría;
- permisos separados para consultar y administrar la salida, más exportación CSV del diagnóstico.
- operación completa del piloto 5.1–5.6: migración validada, cohorte, capacitación, conciliación, incidencias y compuertas de salida.
- despliegue gradual obligatorio 10/25/50/100, pausa controlada, cierre e historial inmutable de ciclos por organización.
- configuración de producción validada, salud live/ready, contenedores sin privilegios y respaldo/restauración comprobable.

## Requisitos

- Node.js 22 o superior.
- npm 11 o superior.
- Docker con Compose, o Podman con una máquina activa, para PostgreSQL.
- LibreOffice con el ejecutable `soffice` disponible, para generar vistas previas al ejecutar la API fuera del contenedor.

## Inicio local

```bash
cp .env.example .env
npm install
bash scripts/local-up.sh
npm run dev
```

`local-up.sh` prepara la base y los datos demo la primera vez. Los scripts detectan automáticamente
Docker o Podman; con Podman, la máquina debe estar activa (`podman machine start` en macOS).
En los siguientes arranques basta con `npm run dev`: ejecuta `local-dev.sh`, carga `.env`, fija la
conexión local, levanta PostgreSQL, espera a que esté listo, genera el cliente Prisma y aplica
cualquier migración pendiente antes de iniciar la API y la web. También puedes ejecutar
`bash scripts/local-dev.sh` directamente.

Si aparece `P1001: Can't reach database server at localhost:55432`, verifica que Docker o la
máquina de Podman estén activos y vuelve a ejecutar `npm run dev`. Para iniciar únicamente API y
web con una base ya disponible y preparada, usa `npm run dev:apps`.

Abre `http://localhost:3000` y utiliza las credenciales locales:

- Usuario: `admin@demo.local`
- Contraseña: `Demo123!`

La API se publica en `http://localhost:4000/api` y PostgreSQL en `localhost:55432`. En desarrollo, los documentos se guardan en `storage/`; en producción puede activarse el adaptador S3-compatible con `STORAGE_DRIVER=s3`.

La misma API publica un servidor MCP local autenticado en `http://127.0.0.1:4000/mcp`, pensado para agentes propios. Conserva la identidad, organización, rol, validaciones y auditoría de cada usuario. La configuración y el ejemplo de cliente están en [`docs/MCP.md`](docs/MCP.md).

La interfaz autenticada incluye Tabelio IA en la esquina inferior derecha. El backend conecta el proveedor de IA con el MCP usando la sesión individual, solicita confirmación antes de cualquier escritura y mantiene la credencial del proveedor fuera del navegador. La instalación y sus límites de seguridad están en [`docs/ASSISTANT.md`](docs/ASSISTANT.md).

La carga documental puede leer identificaciones INE/IFE en JPG, PNG o PDF y presentar sus datos para revisión antes de actualizar una persona. Esta función requiere migraciones al día y activación explícita con `DOCUMENT_EXTRACTION_ENABLED=true`; permanece manual por defecto. Consulta [`docs/EXTRACCION_INE.md`](docs/EXTRACCION_INE.md) para activación, privacidad y recorrido de demostración.

El chat de IA también permite adjuntar, arrastrar o pegar hasta tres PDF/JPG/PNG (20 MB por archivo), identificar INE/IFE y comprobantes de domicilio y mostrar una vista preliminar de los campos leídos. El asistente identifica el expediente y prepara la carga para confirmación; el archivo y su extracción no se guardan en el expediente hasta aprobar. La actualización de una ficha personal requiere otra confirmación. Los originales pendientes permanecen temporalmente en memoria durante un máximo de 20 minutos y se descartan al iniciar una nueva conversación o reiniciar la API.

Para construir la aplicación completa en contenedores:

```bash
docker compose --profile app build
```

Antes de desplegar en cualquier ambiente compartido se deben reemplazar todas las credenciales de ejemplo, ejecutar migraciones versionadas y configurar secretos fuera del repositorio.

## Estructura

```text
apps/api          API NestJS y módulos de negocio
apps/web          Aplicación Next.js
packages/domain   Reglas puras de workflow, checklist y tenencia
packages/database Esquema Prisma/PostgreSQL y semilla local
docs              Alcance, decisiones y backlog de MVP
```

## Pruebas y verificación

### Biblioteca jurídica de Saul y Alex

La sección **Biblioteca jurídica** (`/biblioteca`) consulta los 142 documentos incorporados a Despacho Demo, agrupados en 13 tipos y 31 conjuntos de origen. Incluye búsqueda en contenido, filtros de procedencia, materia, variante y uso, descarga del Word original y observaciones del análisis. Los perfiles con permiso de carga pueden agregar un documento o su conjunto como referencia a un expediente abierto; se conservan tipo y procedencia y se reutilizan las copias idénticas.

Los documentos se almacenan por organización, con descarga autenticada y auditoría. Su incorporación como referencia no los activa como plantillas de generación. La [guía de biblioteca](docs/BIBLIOTECA_JURIDICA.md) explica la importación verificada e idempotente mediante `npm run library:import`.

```bash
npm test
npm run lint
npm run build
```

Con PostgreSQL, la API y la web en ejecución, la prueba integral local valida autenticación,
directorio, deduplicación, inmuebles, ambos tipos de expediente, cancelación controlada y cierre de trabajo abierto, búsqueda global, auditoría administrativa, vigencia, invalidación y detección de duplicados documentales, carga documental múltiple con resultados parciales, evidencia obligatoria y prerrequisitos en tareas, advertencias, corrección y semáforo de consistencia, catálogo configurable, snapshot histórico del checklist, extracción versionada y revisión humana, workflow, documentos,
recuperación de contraseña, portal externo, revocación de invitaciones, revisión de captura, tareas manuales y automáticas, responsables, vencimientos, búsqueda, filtros y exportación CSV operativa, reprogramación motivada, historial de fechas, notas de seguimiento y sus avisos personales, carga operativa, reportes y exportación CSV, catálogo de cláusulas, congelamiento documental, PDF derivado y vista previa, invalidación de sesiones, solicitud de cambios, comparación de versiones,
doble aprobación, firma, activación, recordatorios y bandeja personal de avisos,
alertas, renovación, terminación, cierre y preparación auditada del piloto:

```bash
npm run test:smoke
```

La prueba crea registros identificables como `QA` dentro de la organización demo y no elimina datos.

## Operación y despliegue del piloto

El acceso `Administración → Puesta en marcha` reúne `Prueba inicial` y `Revisión y aprobación`. Está reservado a administración en el menú, las páginas, la API y el asistente. Las rutas anteriores conservan su historial y funciones. El tablero `Prueba inicial → Participantes y seguimiento` cubre todos los subíndices 5.1–5.6. La consulta, los cambios y las exportaciones quedan reservados a administración. Ningún programa puede iniciar o cerrar sin migración confirmada, dos participantes capacitados, la muestra conciliada y cero incidencias altas o críticas abiertas.

Para validar el ambiente completo:

```bash
npm run pilot:check
```

Para crear y comprobar un respaldo de PostgreSQL y archivos locales:

```bash
npm run pilot:backup
npm run pilot:verify-backup -- '/ruta/mostrada/por/el/comando/anterior'
```

El despliegue endurecido usa `.env.pilot.example`, `compose.pilot.yaml` y `npm run pilot:deploy`; funciona con Podman o Docker, crea un respaldo previo, aplica migraciones y exige una verificación `ready` antes de concluir. La guía de operación, escalamiento, restauración y reversión está en [`docs/PILOT_RUNBOOK.md`](docs/PILOT_RUNBOOK.md).

## MVP 6: aceptación y preparación de lanzamiento

La pantalla `Lanzamiento` completa 6.1–6.6 sin ejecutar despliegues: diagnóstico activo del ambiente, cinco categorías UAT, simulación o verificación de adaptadores, seis controles de seguridad/cumplimiento, fotografía firmada con SHA-256 de las métricas del último piloto y decisión GO/NO-GO inmutable.

Administración consulta, opera y exporta el centro de revisión y aprobación. Los simuladores de OCR, firma, correo, calendario y recuperación no realizan llamadas externas y sólo satisfacen un ambiente `LOCAL`. Staging o producción requieren evidencia de proveedores reales.

La aceptación integral se ejecuta con:

```bash
npm run launch:check
```

El flujo operativo, los criterios de evidencia y los límites del alcance están en [`docs/MVP6_RUNBOOK.md`](docs/MVP6_RUNBOOK.md).

La generación documental se habilita para perfiles jurídicos cuando el expediente está listo para
elaborar. Las plantillas v1 conservan el clausulado y diseño originales, materializan variables
controladas y bloquean datos incompletos o incompatibles con sus condiciones fijas. El convenio
reutiliza las partes, inmuebles y condiciones del arrendamiento vinculado. Cada resultado se guarda
como `DRAFT_CONTRACT`, con versión, checksum, auditoría y descarga autenticada.

Cada DOCX puede convertirse una sola vez a `DRAFT_CONTRACT_PDF` mediante el puerto de conversión.
El PDF conserva la versión y snapshots de cláusulas, además de una relación explícita con el DOCX
origen. La operación es idempotente, la vista previa se sirve en línea sólo después de autenticar al
usuario y el sistema no permite enviar a revisión una versión que todavía no tenga PDF. En local se
usa LibreOffice; puede elegirse el binario con `LIBREOFFICE_BIN` y el contenedor de API ya lo incluye.

Sólo el último borrador puede enviarse a revisión. Una solicitud de cambios devuelve el expediente
a elaboración y exige generar otra versión antes de revisarlo nuevamente. La aprobación jurídica
lo lleva a aprobación final, reservada al rol administrador; al aprobarse, avanza a firma. Los pasos
no pueden omitirse mediante una transición manual.

En la etapa de firma se crea una solicitud ligada al PDF derivado del último borrador aprobado. La implementación
actual permite completar el proceso de manera manual cargando el PDF o Word firmado; el mismo
contrato de proveedor permite incorporar después una plataforma de firma electrónica. Al completar
la solicitud se guarda la copia como `SIGNED_CONTRACT` y el expediente pasa a activo. También se
puede cancelar una solicitud pendiente con un motivo auditado y generar otra.

Las alertas de vigencia se calculan directamente desde la fecha final del arrendamiento, evitando
datos duplicados que puedan quedar desactualizados. El tablero prioriza contratos activos dentro de
las ventanas de 90, 60, 30 y 15 días o ya vencidos. Al iniciar una renovación se crea un expediente
relacionado en integración con las partes, inmuebles y condiciones precargadas; la evidencia
documental permanece pendiente para confirmar que siga vigente.

Al activar un arrendamiento se persisten cuatro recordatorios internos deduplicados. Si cambia la
vigencia se cancelan los anteriores y se programa la nueva serie; al cerrar el expediente se
cancelan los pendientes. Un perfil jurídico o administrador puede sincronizarlos manualmente y
marcarlos como atendidos, dejando evidencia en auditoría. El modelo ya contempla canales `EMAIL` y
`CALENDAR`, pero sólo `IN_APP` está habilitado hasta elegir y configurar proveedores externos.

La recuperación de contraseña usa un token aleatorio que sólo se persiste como hash, caduca a los
30 minutos y se consume una sola vez. En desarrollo, `PASSWORD_RECOVERY_DRIVER=local` muestra el
enlace en la interfaz y en la consola para poder probar el flujo. En producción ese mecanismo se
deshabilita y deberá sustituirse por un adaptador de correo. El cambio de contraseña incrementa la
versión de sesión del usuario, por lo que todos sus JWT anteriores dejan de funcionar.

El catálogo de cláusulas separa la redacción jurídica de su aprobación. Una versión borrador no
puede seleccionarse; al aprobar una nueva, la anterior queda retirada para contratos nuevos. Los
expedientes que ya utilizaban la versión anterior la conservan explícitamente. Al generar el DOCX,
las cláusulas seleccionadas se insertan antes de las firmas y se guarda un snapshot inmutable con
código, título, texto, versión y orden, además del registro correspondiente en auditoría.

El portal del cliente usa invitaciones asociadas a un expediente y a un rol específico. El valor
secreto sólo se entrega al crear la invitación; la base conserva su hash. El enlace vence, puede
revocarse y deja de funcionar al aceptar la captura. La persona externa puede guardar datos,
cargar o retirar archivos y enviarlos a revisión, pero no consulta el expediente interno. La
aceptación humana crea o actualiza la persona asociada, agrega su rol y promueve los archivos al
repositorio documental versionado. Un rechazo conserva el motivo y permite corregir y reenviar.

Las tareas conservan expediente, responsable, prioridad, vencimiento, origen manual o automático y
su historial en auditoría. No se eliminan: se completan, cancelan o reabren. El tablero calcula el
atraso en tiempo de consulta y agrupa la carga abierta por integrante. Al enviarse una captura del
portal se crea de forma idempotente una tarea de revisión asignada al responsable del expediente;
aceptarla o rechazarla cierra la tarea, y un reenvío posterior la vuelve a abrir con un nuevo plazo.

El responsable operativo se elige entre las membresías activas con funciones administrativas,
jurídicas u operativas de la organización. Puede cambiarse desde el expediente; la reasignación queda
auditada y actualiza las tareas automáticas abiertas y los recordatorios pendientes. Las tareas
manuales conservan a su responsable original para no sobrescribir decisiones explícitas del equipo.

El reporte operativo permite elegir hasta 366 días y separa las métricas del periodo de la situación
actual al corte. Muestra expedientes y documentos creados, aprobaciones, firmas, activaciones,
tiempos promedio, cumplimiento de tareas, pipeline, carga individual, renovaciones en riesgo y
expedientes sin actividad durante siete días. La descarga CSV neutraliza valores interpretables como
fórmulas por una hoja de cálculo y requiere un permiso de exportación separado.

El catálogo de requisitos está aislado por organización y separado por tipo de expediente. Los
requisitos base usan validaciones automáticas; los requisitos agregados por administración se
confirman manualmente dentro del expediente. Cada expediente copia la definición vigente al
crearse, incluyendo etiqueta, rol, obligatoriedad y modo de validación. Editar, reordenar o
desactivar una definición sólo afecta expedientes futuros y conserva la historia operativa.

El buscador global consulta únicamente la organización activa y agrupa coincidencias de expedientes,
personas, inmuebles y documentos. Admite referencias, nombres, RFC, correo, teléfono, domicilios y
nombres de archivo. Los resultados documentales no exponen llaves internas del almacenamiento y
conservan la autorización normal al abrir un expediente o descargar un archivo.

El centro de auditoría consolida los eventos inmutables de toda la organización y permite filtrar por
periodo, texto, acción, entidad y responsable. Distingue acciones con usuario de procesos del sistema
o del portal, enlaza el expediente cuando existe y permite exportar hasta 10,000 eventos a un CSV
neutralizado contra fórmulas. Su consulta y exportación están reservadas a administración.

El repositorio documental central calcula la vigencia al momento de consulta y separa documentos
vencidos, próximos a vencer en 15, 30 o 90 días, vigentes y sin fecha registrada. Emisión y
vencimiento pueden capturarse al cargar o corregirse después por un perfil con permiso documental;
cada ajuste queda auditado. Los documentos vencidos permanecen disponibles como evidencia histórica,
pero dejan de completar los requisitos automáticos hasta renovar la evidencia o corregir su fecha.

Las renovaciones documentales no eliminan ni ocultan la versión anterior dentro del expediente. La
plataforma elige la versión operativa más reciente por persona para identificaciones, RFC y domicilio;
por inmueble para acreditaciones de propiedad; y por tipo para documentos jurídicos controlados. Los
archivos `OTHER` permanecen independientes. Sólo la versión operativa alimenta vigencia, checklist,
advertencias y búsqueda global; las anteriores se muestran como históricas y siguen descargables. Si
la versión vigente se invalida, la anterior activa se recupera automáticamente para esos cálculos.

Dentro de cada expediente, la carga múltiple permite preparar hasta 10 archivos y clasificar cada uno
por tipo documental, persona, inmueble, emisión y vencimiento. El procesamiento es secuencial para
mantener versiones deterministas; una fila inválida se reporta y permanece lista para corregirse, sin
revertir los archivos correctos. Cada documento aceptado genera su propio evento de auditoría y la
siguiente consulta del expediente recalcula automáticamente el checklist.

Antes de almacenar una carga, la plataforma calcula su SHA-256 y lo compara únicamente dentro del
mismo expediente. Un archivo idéntico se rechaza aunque haya cambiado de nombre o clasificación;
el usuario debe reutilizar, reclasificar o restaurar el registro existente. Los lotes mantienen resultados
parciales y esta protección también aplica al portal, al contrato firmado y a la evidencia de cierre.

El panel de consistencia analiza únicamente datos estructurados y la versión operativa de cada
identidad documental. Advierte identificaciones o acreditaciones ligadas a otra entidad, documentos
vencidos o próximos a vencer, participantes con roles incompatibles, duración contractual discordante,
pagos iniciales que no cuadran y convenios asociados a otro inmueble. Las advertencias explican el
hallazgo y la corrección sugerida, pero no sustituyen la revisión humana ni bloquean el workflow.

Las clasificaciones manuales pueden corregirse desde el expediente. Cada cambio conserva archivo,
checksum y trazabilidad, registra valores anteriores y nuevos, y recalcula la versión cuando cambia
el tipo documental. Los DOCX/PDF generados, contratos firmados y evidencias de terminación permanecen
protegidos por sus flujos controlados y no admiten reclasificación manual.

La vigencia documental se conecta con el trabajo operativo. Una versión vigente que ya venció o se
encuentra dentro de los próximos 30 días genera una tarea de sistema asignada al responsable del
expediente: urgente hasta 15 días y alta entre 16 y 30. La tarea no puede cerrarse manualmente; se
completa al incorporar una versión posterior y se cancela si la fecha deja de aplicar, el documento se
invalida o concluye el expediente. Si la versión nueva se invalida y reaparece una anterior en riesgo,
la misma tarea se reabre. El tablero permite sincronizar toda la organización de forma idempotente.

El SLA de tareas se escala con reglas transparentes: una tarea vencida entra en nivel 1 y alcanza al
menos prioridad alta; a partir del tercer día entra en nivel 2 y se vuelve urgente. La sincronización
conserva responsable y contenido, registra cada cambio de nivel y no duplica eventos al repetirse. Por
ahora se ejecuta desde el tablero; el mismo servicio queda listo para conectarse a un programador sin
incorporar correo, calendario ni decisiones de IA.

La bandeja de avisos convierte las asignaciones y escalaciones en seguimiento persistente dentro de la
plataforma. Cada destinatario ve únicamente sus avisos, puede reconocerlos y conserva el vínculo al
expediente o tarea. Una reasignación cancela el aviso anterior y crea el correspondiente al nuevo
responsable; completar, cancelar o cerrar el trabajo cancela los avisos que ya no requieren atención.

Una tarea sólo puede pasar a bloqueada con un motivo explícito. El bloqueo vigente muestra quién lo
registró, cuándo ocurrió y su antigüedad; al retomar o completar la tarea se limpian los campos activos,
pero el motivo resuelto permanece en auditoría. El reporte separa bloqueos activos y destaca los que
superan 48 horas para que la dirección pueda intervenir sobre causas concretas.

El semáforo del expediente combina los requisitos y advertencias ya calculados: rojo cuando persisten
requisitos bloqueantes, amarillo cuando sólo quedan recomendaciones o hallazgos no bloqueantes, y
verde cuando no hay pendientes relevantes. Cada estado incluye sus motivos concretos y evita un
puntaje artificial difícil de explicar al equipo jurídico.

La cancelación de un expediente previo a activación requiere un motivo explícito y conserva responsable
y fecha. En una sola transacción cancela las tareas abiertas, revoca invitaciones externas y cancela
solicitudes de firma pendientes. El expediente queda disponible para consulta y auditoría, pero ya no
admite cambios de datos base, nuevas tareas, cargas documentales ni una segunda cancelación.

La terminación se registra como un proceso auditable con estado previo, motivo, fecha efectiva y
responsable. Puede cancelarse de forma motivada y restaura el estado anterior. El cierre sólo ocurre
al cargar evidencia en PDF, Word o imagen; el archivo se guarda como `TERMINATION_EVIDENCE` y las
transiciones manuales que omitirían el proceso son rechazadas.

Cada solicitud de extracción crea una ejecución con proveedor, estado, datos crudos y candidatos por
campo; una ejecución pendiente se reutiliza para no repetir la lectura. El modo manual no inventa
información. Con `DOCUMENT_EXTRACTION_ENABLED=true`, las identificaciones de arrendador, arrendatario y
obligado solidario pueden leerse con el proveedor de IA ya configurado. La carga muestra el destino de
los archivos y permite desactivar su envío. Otros tipos documentales conservan la captura manual.
Un usuario autorizado confirma, corrige o rechaza el resultado con comentario obligatorio; sólo después
se guardan los datos confirmados en el documento. Opcionalmente aplica campos seleccionados a una
persona física del mismo Directorio: los datos existentes requieren autorización adicional de reemplazo,
y los cambios simultáneos se rechazan. Persona, documento y revisión se guardan en una transacción;
la auditoría de la actualización enumera campos, no sus valores. La revisión es inmutable y conserva
autor y fecha. La lectura no verifica autenticidad ni vigencia de la identificación.

El centro de preparación para piloto combina controles derivados del entorno con cinco confirmaciones
operativas: muestra de datos, capacitación, operación paralela, soporte y respaldo/restauración. Base de
datos y administrador activo son bloqueantes técnicos; almacenamiento local, proveedores manuales,
extracciones pendientes y tareas vencidas se muestran como advertencias no bloqueantes. Administración
consulta, registra o reabre cada checkpoint con evidencia auditada. El
resultado puede exportarse como CSV para documentar la decisión de salida.

## Decisiones de seguridad

- El `organizationId` se obtiene del token firmado; no se acepta desde el cliente.
- Todas las consultas de negocio incluyen el alcance de organización.
- Los documentos se guardan bajo una llave prefijada por organización y expediente.
- La auditoría registra altas, modificaciones, cargas y transiciones.
- Las decisiones jurídicas conservan autor, fecha, comentario, documento y versión; no hay rutas para modificarlas o eliminarlas.
- El rol jurídico puede revisar, pero la aprobación final requiere un administrador.
- Un expediente no puede activarse sin una solicitud de firma completada y su documento firmado.
- La solicitud conserva proveedor, documento origen aprobado, responsables, fechas y resultado.
- La terminación y el cierre conservan responsables, motivos, fechas y evidencia descargable.
- Cada recordatorio pertenece a la organización y al expediente, y usa una llave de deduplicación estable.
- Cada petición autenticada vuelve a validar usuario activo, membresía, rol y versión de sesión contra la base de datos.
- Los tokens de recuperación nunca se guardan en texto plano, expiran y no se pueden reutilizar.
- Los intentos fallidos se contabilizan sin revelar si una cuenta existe y pueden bloquearla temporalmente.
- Los enlaces del portal tienen 256 bits de entropía; sólo se almacena SHA-256 y nunca se exponen hashes en listados.
- La captura externa obtiene la organización y el expediente exclusivamente desde la invitación validada.
- Ningún dato o archivo externo se incorpora al directorio o repositorio formal sin aceptación de un usuario interno.
- Cada tarea está aislada por organización; sólo puede asignarse a una membresía activa de esa misma organización.
- Las tareas automáticas usan llaves de deduplicación y no generan duplicados ante reintentos.
- Los reportes respetan la organización activa y limitan su periodo para mantener consultas predecibles.
- Sólo administración puede modificar el catálogo de requisitos; el perfil jurídico tiene acceso de lectura.
- El checklist de cada expediente es un snapshot y no cambia retroactivamente al editar el catálogo.
- La búsqueda exige permisos de lectura y aplica `organizationId` en todas sus consultas.
- Los resultados de documentos no incluyen rutas, buckets ni llaves internas de almacenamiento.
- La bitácora organizacional es de sólo lectura y únicamente administración puede consultarla o exportarla.
- La exportación de auditoría limita periodo y volumen para evitar extracciones accidentales sin acotar.
- Las fechas documentales se validan para impedir vencimientos anteriores a su emisión.
- Un documento vencido no se elimina ni se oculta, pero no cuenta como evidencia vigente del checklist.
- La lectura de reportes está separada del permiso para exportar información fuera de la plataforma.
- Sólo cláusulas aprobadas pueden agregarse a un expediente y la selección se bloquea al iniciar la revisión.
- Cada documento conserva su propio snapshot de cláusulas, independiente de cambios posteriores del catálogo.
- Cada PDF conserva documento origen, versión, checksum y snapshots; no se regenera ni reemplaza silenciosamente.
- El proveedor automático permanece deshabilitado; cada ejecución exige una revisión humana inmutable antes de persistir datos confirmados.
- Los checkpoints del piloto pertenecen a la organización activa, sólo administración puede modificarlos y toda reapertura o confirmación queda auditada.
- La cancelación no elimina información: conserva expediente, documentos, decisiones y actividad, y cierra el trabajo pendiente de forma atómica.
- El checksum se calcula antes de escribir el archivo y evita copias idénticas en el mismo expediente sin impedir reutilizar evidencia en asuntos distintos.
- Las versiones históricas conservan archivo y descarga, pero sólo la versión operativa participa en cálculos y búsquedas; invalidarla reactiva la anterior disponible.
- Las tareas de renovación documental se deduplican por archivo y sólo se cierran por un cambio comprobable en la evidencia, no por confirmación manual.
- Un responsable de expediente debe ser una membresía activa de la misma organización con rol `ADMIN`, `LAWYER` u `OPERATOR`; no se permite degradarlo a `VIEWER` mientras conserve expedientes abiertos.
- La escalación de SLA sólo consulta tareas abiertas de expedientes activos dentro de la organización autenticada y nunca reduce una prioridad asignada previamente.
- La bandeja interna filtra por organización y destinatario; salvo administración, un usuario no puede reconocer avisos dirigidos a otra persona.
- El motivo de bloqueo exige al menos diez caracteres, pertenece a una tarea de la organización activa y nunca sustituye ni elimina su historial de auditoría.
