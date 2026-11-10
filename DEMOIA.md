# DEMO IA — Casos de uso y comprobación de Tabelio

**Aplicación:** Tabelio  
**Actualización:** 2 de noviembre de 2026  
**Guion para presentar toda la aplicación:** [PresentacionTabelio.md](PresentacionTabelio.md)

Esta guía permite ensayar la IA, copiar prompts y comprobar los resultados contra la aplicación. La presentación completa, la preparación de los expedientes, los tiempos y las frases para el cliente están en el guion enlazado.

**Estado de esta revisión:** documentación contrastada con el código y las guías del proyecto. No se ejecutaron en esta revisión pruebas con el proveedor ni se preparó la base de datos. Las casillas de ensayo deben completarse antes de presentar.

## 1. Qué se demuestra

La IA está disponible en **Tabelio IA**, en los adjuntos del chat y en cuatro análisis del expediente. Interpreta solicitudes, consulta registros permitidos, redacta explicaciones con fuentes y prepara cambios. Cada escritura del asistente necesita una confirmación visible del usuario.

| Función | Cómo activarla | Comprobación |
| --- | --- | --- |
| Chat de gestión | Abrir Tabelio IA y escribir una solicitud. | Comparar respuesta y acciones con el módulo correspondiente. |
| Lectura de adjuntos con IA | Seleccionar **Con IA** antes de adjuntar PDF/JPG/PNG. | Cotejar campos con el original y confirmar por separado guardado y actualización personal. |
| Resumen del expediente | Resumen → Análisis del expediente → **Con IA** → ejecutar. | Revisar síntesis, fuentes y límites de cobertura. |
| Inconsistencias | En el mismo panel, elegir **Con IA** y ejecutar la revisión. | Distinguir diferencias, datos faltantes y advertencias de reglas. |
| Clasificación sugerida | Documentos → desplegar **Analizar clasificación** → **Con IA** → **Analizar clasificación con IA**. | Comprobar propuesta sin cambio automático del documento. |
| Comparación explicada | **Comparar anterior** en un borrador DOCX con versión previa → **Con IA**. | Contrastar explicación con el diff exacto por párrafos. |
| Consumo | Abrir **Presupuesto y consumo** en el chat. | Ver llamadas, tokens y el estado real de los importes. |

En los cuatro análisis, el modo predeterminado es **Sin IA · reglas locales**. Elegir **Con IA** no ejecuta por sí mismo el análisis: hay que pulsar su botón. En el chat también debe pedirse expresamente «con IA» para esos análisis; de lo contrario sus herramientas usan el modo local.

El modelo y el proveedor dependen de la configuración vigente del servidor. Un alias configurado no certifica por sí solo el modelo servido. No hace falta mencionar un modelo concreto para demostrar estas capacidades.

**Criterio de éxito:** aprobar el 100 % de los casos acordados y ensayados, con evidencia. Eso no equivale a garantizar exactitud universal, disponibilidad permanente del proveedor o autenticidad de documentos.

## 2. Preparación antes del ensayo

1. Iniciar la aplicación local siguiendo [README.md](README.md). En una instalación ya preparada:

       npm run dev

2. Con API y web disponibles, preparar los ejemplos de tareas:

       npm run demo:prepare

   El comando usa la organización demo y admin@demo.local; admite una contraseña diferente mediante DEMO_PASSWORD. Crea o reutiliza por título estos tres expedientes:

   | Expediente | Tareas previstas |
   | --- | --- |
   | DEMO IA - Arrendamiento Alameda | Revisar identificación: vencida dos días. Preparar borrador: en curso, a dos días. |
   | DEMO IA - Arrendamiento Chapultepec | Validar propiedad: vencida un día. Revisar condiciones: a cinco días. |
   | DEMO IA - Arrendamiento Providencia | Programar firma: a catorce días. Recabar datos del obligado: sin fecha. |

   Son seis tareas asignadas a admin: **dos vencidas, tres en plazo y una sin fecha** en la preparación inicial. El script usa fechas relativas fijadas a las 18:00 UTC; comparar con la fecha y zona mostradas en la app. No filtrar sólo los próximos siete días: se perdería la tarea a catorce días.

   Puede repetirse y no borra otros registros, pero reabre o reprograma las tareas de esos títulos. Si ya se modificaron esos ejemplos, revisar el resultado antes de usar los conteos como referencia. No prepara partes, inmuebles, condiciones ni documentos para generar contratos.

3. Preparar un expediente de arrendamiento completo y otro incompleto; anotar referencias. Para comparación se necesitan dos versiones de borrador DOCX. Para aprobación y firma, el PDF de la versión vigente.
4. Preparar una persona física ya vinculada a un expediente y archivos ficticios legibles: identificación y comprobante de domicilio. Conservar una copia distinta para el reintento de carga.
5. Probar realmente el proveedor con texto y documentos. La lectura con IA requiere ASSISTANT_ENABLED, credencial privada y DOCUMENT_EXTRACTION_ENABLED; además, soporte de visión, salida estructurada y archivos PDF cuando se usen.
6. Verificar lectura local y PDF si se mostrarán: requieren herramientas locales de OCR/PDF y LibreOffice, respectivamente. Un error local no activa la IA.
7. Usar una cuenta ADMIN para todo el recorrido y una VIEWER de prueba en otro perfil de navegador para demostrar permisos, si está preparada.
8. Realizar una escritura a la vez y esperar su resultado. Confirmaciones y continuaciones duran diez minutos; adjuntos pendientes, hasta veinte. No reiniciar la API a mitad de esos casos.

Los valores entre corchetes se sustituyen antes de enviar: **[REFERENCIA]**, **[PERSONA]**, **[DOCUMENTO]**, **[TAREA]** y **[FECHA]**. Para altas en vivo se propone el sufijo **01**; cambiarlo en todos los prompts si ya existen esos registros.

## 3. Consultas, contexto y navegación

### IA-01. Consultar tareas reales y distinguir fechas

**Prompt:**

> Muéstrame mis tareas pendientes de los expedientes DEMO IA. Separa las vencidas, las que están en plazo y las que no tienen fecha límite. Incluye título, expediente, responsable, fecha y totales. Indica si sólo estás mostrando una selección.

**Comprobar:** contrastar con Tareas usando la misma búsqueda y responsable. En datos recién preparados deben aparecer las seis tareas de la sección 2. «En plazo» incluye la de catorce días y la que está en curso. Con más datos, el resumen puede mostrar hasta ocho por grupo y debe indicar que hay más.

**Valor para el cliente:** saber qué atender sin recorrer expedientes uno por uno.

### IA-02. Buscar expedientes y resolver una referencia conversacional

**Prompt inicial:**

> Muéstrame los tres primeros expedientes del listado disponible. Incluye referencia, título, estado y responsable. Explica el orden utilizado.

**En la misma conversación:**

> Del primero que acabas de mostrar, dime qué partes están registradas y qué requisitos obligatorios siguen pendientes.

**Comprobar:** el seguimiento corresponde al mismo expediente y sus pendientes coinciden con el checklist. Si hay menos de tres, se muestran sólo los existentes.

### IA-03. Adaptar una explicación al cliente

**Después del caso anterior:**

> Resume esos pendientes en tres puntos para un cliente que no conoce la aplicación. Conserva los hechos y señala qué información falta.

**Comprobar:** cambia la redacción y mantiene los datos; no añade decisiones jurídicas ni información inexistente.

### IA-04. Abrir el contexto correcto

> Abre el expediente [REFERENCIA].

**Comprobar:** la referencia de la pantalla abierta coincide. Puede repetirse con «Abre Tareas» para mostrar navegación entre módulos.

### IA-05. Dictar una consulta

1. Pulsar el micrófono, permitir su uso y decir: «Muéstrame mis tareas pendientes».
2. Revisar la transcripción y enviar.
3. Contrastar con Tareas.

**Comprobar:** se interpreta el texto transcrito. El dictado usa el reconocimiento del navegador, separado del modelo del chat. Puede depender de un servicio del fabricante; fuera de localhost requiere HTTPS y compatibilidad del navegador.

### IA-06. Continuar una consulta extensa

> Consulta los primeros diez expedientes del listado disponible y resume estado, responsable y requisitos pendientes de cada uno. Indica cuáles alcanzaste a revisar.

**Comprobar:** informa el avance real. Si ofrece **Continuar desde aquí**, pulsar durante la misma sesión y comprobar que continúa; si termina toda la consulta, no necesita ese botón.

## 4. Acciones confirmadas y control de datos

### IA-07. Cancelar y luego confirmar un alta

> Registra en el Directorio una persona física llamada DEMO CLIENTE - Elena Torres 01, de nacionalidad mexicana y ocupación arquitecta. Deja vacíos los datos que no te proporcioné.

1. Revisar la tarjeta y pulsar **Cancelar**.
2. Buscar el nombre en Directorio: no debe existir un alta nueva.
3. Repetir el prompt y **Confirmar**.
4. Verificar nombre, tipo de persona, nacionalidad y ocupación en Directorio.

**Éxito:** sólo se guarda después de la confirmación; correo, teléfono y nacimiento siguen sin inventarse.

### IA-08. Actualizar únicamente el campo solicitado

> Cambia la ocupación de DEMO CLIENTE - Elena Torres 01 a ingeniera civil. Conserva los demás datos.

**Comprobar:** confirmar una actualización y verificar el cambio y la conservación de los otros campos.

### IA-09. Reconocer información ausente

> Dime el correo y la fecha de nacimiento registrados para DEMO CLIENTE - Elena Torres 01. Si algún dato no está capturado, indícalo.

**Comprobar:** responde que faltan si siguen vacíos. No presentar una respuesta sin datos como un fallo de IA cuando la ficha realmente está incompleta.

### IA-10. Crear expediente y tarea vinculada

Enviar por separado, confirmando cada operación:

> Crea un expediente de arrendamiento titulado DEMO CLIENTE - Arrendamiento Olivo 01. No agregues inmuebles, partes ni condiciones que no te haya indicado.

> En el expediente DEMO CLIENTE - Arrendamiento Olivo 01, crea una tarea titulada DEMO CLIENTE - Revisar documentación 01, con prioridad alta y sin fecha límite.

**Comprobar:** referencia generada, tarea vinculada, prioridad y ausencia de fecha. La asignación debe revisarse en la propuesta; no asumir un responsable si no se pidió.

### IA-11. Registrar seguimiento y reprogramación motivada

Con una tarea manual que permita reprogramación:

> Agrega a la tarea [TAREA] del expediente [REFERENCIA] la nota: Revisión de documentación realizada durante la presentación al cliente.

Después de confirmar:

> Reprograma la tarea [TAREA] del expediente [REFERENCIA] al [FECHA Y HORA CON ZONA], con motivo: Fecha acordada para recibir la documentación del cliente.

**Comprobar:** nota inmutable con autor/fecha e historial de reprogramación. Las tareas automáticas de vigencia documental se resuelven renovando la evidencia; no usarlas para este caso.

## 5. Documentos: lectura, revisión y aplicación separadas

### IA-12. Lectura local como referencia

1. En el chat, elegir **Sin IA · local**, adjuntar un PDF/JPG/PNG ficticio y enviar.
2. Revisar el texto/campos preliminares.
3. Comprobar que no se creó un documento en el expediente ni una actualización de persona, y que no aumentaron las llamadas de IA por esa lectura.

**Resultado esperado:** lectura local, sin invocar al asistente. El texto local no entra automáticamente en el contexto de mensajes posteriores. Para guardar el original sin IA, usar **Documentos** del expediente.

Este caso prueba la alternativa local; no cuenta como demostración de inferencia con IA.

### IA-13. Leer y guardar un adjunto con IA desde el chat

**Precondición:** persona física registrada, vinculada con el rol correcto y archivo ficticio legible.

1. Elegir **Con IA** en el chat.
2. Pulsar **Adjuntar documentos** (＋), arrastrar el archivo o pegar una imagen.
3. Enviar:

> Esta identificación corresponde a [PERSONA], quien ya está registrada como arrendataria en el expediente [REFERENCIA]. Muéstrame los datos visibles y prepara su guardado como identificación de esa arrendataria.

4. Revisar tipo detectado, campos y destino. Si hay ambigüedad, resolverla con nombre, referencia y rol.
5. Cancelar la primera propuesta y verificar que no apareció el documento.
6. Preparar de nuevo el guardado y confirmar. Si el adjunto ya no está disponible, volver a adjuntar el original.
7. Abrir Documentos y comprobar original y extracción pendiente; revisar Directorio para verificar que aún no cambió la ficha.

**Éxito:** lectura preliminar, confirmación de guardado y ausencia de actualización personal automática.

**Límites:** hasta tres PDF/JPG/PNG por mensaje y 20 MB por archivo. Reconoce INE/IFE y comprobantes de domicilio en el chat; el titular de un recibo no determina automáticamente la persona o el rol.

### IA-14. Aplicar campos con otra confirmación

**Después del guardado:**

> Registra la revisión de la extracción pendiente de la identificación [DOCUMENTO] del expediente [REFERENCIA] para [PERSONA]. Compara los datos con su ficha y prepara aplicar únicamente [CAMPOS SELECCIONADOS]; explica cualquier valor existente que se reemplazaría. Usa el comentario: Datos cotejados con el original durante la demostración.

1. Revisar la segunda propuesta y confirmar sólo los campos deseados.
2. Verificar la ficha de Directorio y la revisión de extracción.
3. Si hace falta cotejo detallado, hacerlo desde **Extracciones → Ver original**.

**Alternativa desde pantalla:** seleccionar los campos, autorizar expresamente cada reemplazo de datos existentes, escribir un comentario de al menos diez caracteres y pulsar **Confirmar y guardar campos seleccionados**.

**Control adicional:** solicitar otra extracción y **Rechazar extracción**; la persona debe permanecer sin cambios por ese rechazo.

### IA-15. Leer una identificación desde el expediente

1. Expediente → Documentos → **Carga documental múltiple**.
2. Seleccionar archivo ficticio, tipo de identificación y persona vinculada.
3. En **Lectura al guardar**, elegir **Leer con IA**, leyendo el aviso del proveedor.
4. Guardar y abrir **Extracciones**; revisar original, corregir y confirmar campos.
5. Verificar la ficha y la revisión guardada.

El selector también ofrece **Guardar sin leer** y **Leer localmente (sin IA)**. En cargas de hasta diez archivos puede haber resultados parciales. Si el archivo quedó guardado y sólo falló la lectura, reintentar la extracción desde el expediente; no recargar el original.

La lectura no certifica autenticidad, identidad, fotografía, firma ni vigencia. Usar documentos ficticios. Invalidar conserva archivo e historial; **Eliminar** exige motivo y confirmación explícita, y no revierte campos ya aplicados al Directorio.

## 6. Cuatro análisis con IA y fuentes

### IA-16. Resumen del expediente

> Genera con IA un resumen del expediente [REFERENCIA]. Cita las fuentes consultadas, identifica datos faltantes e indica cualquier límite de cobertura.

**Comprobar:** estado, partes, condiciones, tareas y requisitos coinciden con Resumen. Las fuentes pertenecen al expediente. El análisis no modifica el semáforo ni los datos.

### IA-17. Explicar inconsistencias

> Revisa con IA las inconsistencias del expediente [REFERENCIA]. Distingue diferencias confirmadas de datos ausentes y cita sus fuentes. Indica qué debe revisar una persona.

**Comprobar:** contrastar con los datos y las advertencias visibles. Si no hay diferencias sustentadas, debe indicarlo. No crear una inconsistencia sólo para obtener una respuesta llamativa.

### IA-18. Sugerir clasificación sin aplicarla automáticamente

> Sugiere con IA la clasificación del documento [DOCUMENTO] del expediente [REFERENCIA], sin guardar cambios.

**Comprobar:** identificación, comprobante de domicilio u Otro según evidencia. No deduce si la persona es arrendador/arrendatario/obligado por su credencial.

Desde Documentos, **Usar sugerencia** rellena el formulario; sólo **Guardar corrección** aplica la clasificación revisada. Los documentos jurídicos controlados no se reclasifican como cargas ordinarias.

### IA-19. Explicar cambios entre versiones

> Explica con IA los cambios entre el borrador DOCX [DOCUMENTO] del expediente [REFERENCIA] y su versión anterior. Cita los párrafos y utiliza la comparación exacta como referencia.

**Comprobar:** requiere dos versiones de borrador DOCX. Comparar la explicación con **Comparar anterior**. Se explican diferencias de texto, no diseño, firmas ni imágenes. Los recortes de cobertura deben indicarse.

En cualquiera de estos cuatro casos se puede repetir desde su panel eligiendo **Sin IA · reglas locales** y luego **Con IA**. Los resultados locales no generan llamadas de IA. La respuesta con IA muestra modo, fecha, fuentes y límites; no cambia automáticamente al modo local ante un error.

## 7. Generación, revisión, operación y medición

### IA-20. Generar DOCX, PDF y descargar

**Precondición:** arrendamiento completo en listo para elaborar o elaboración, datos compatibles con la plantilla v1 y usuario autorizado.

Enviar y confirmar por separado:

> Genera el borrador del contrato de arrendamiento del expediente [REFERENCIA] con la plantilla, datos y cláusulas registrados. Usa como fecha de celebración [FECHA].

> Genera la vista previa PDF del último borrador DOCX del expediente [REFERENCIA].

> Busca el documento [DOCUMENTO] del expediente [REFERENCIA] y dame su botón de descarga, sin generar otra versión.

**Comprobar:** DOCX versionado, PDF asociado al DOCX vigente, vista previa y botón de descarga autenticado. La descarga del existente no crea otra versión.

La IA solicita la operación; la plantilla jurídica compone el documento y LibreOffice convierte a PDF. Si faltan datos o requisitos, el resultado correcto es explicar el bloqueo. No pedir que se inventen ni se salten controles.

### IA-21. Consultar operación, reporte y auditoría

Enviar por separado:

> Del expediente [REFERENCIA], enumera los requisitos obligatorios pendientes y explica cuáles bloquean avanzar a listo para elaborar.

> Muéstrame mis avisos pendientes e indica a qué expediente o tarea corresponde cada uno.

> Consulta el reporte operativo de los últimos 30 días. Indica el periodo utilizado y resume tareas atrasadas, carga por responsable y bloqueos que aparezcan. Distingue métricas del periodo de la situación actual.

Con ADMIN, después de una escritura confirmada:

> Consulta la bitácora del expediente [REFERENCIA] y resume los movimientos recientes, con fecha, acción y responsable.

**Comprobar:** cada respuesta contra Checklist, Avisos, Reportes o Auditoría con filtros equivalentes.

### IA-22. Mostrar consumo de las operaciones

1. Abrir **Presupuesto y consumo** y anotar llamadas/tokens antes de una consulta.
2. Ejecutar IA-16 o una consulta del chat.
3. Abrir el detalle: comprobar operación, llamadas, tokens e importe con su etiqueta.
4. Ejecutar un análisis local desde el expediente y comprobar que no genera una operación de IA.

**Explicación:** **Este chat** corresponde a su conversación; **Última operación** y consumo personal incluyen operaciones iniciadas desde el expediente. Un error o cancelar el guardado no elimina el costo de una lectura ya realizada.

El saldo IBM se muestra en **Advantage Credits**, con sesión W3 y conector compatible. Una estimación por tokens en USD no es un cargo confirmado de IBM ni una conversión de esos créditos. Si falta tarifa, mostrar el estado pendiente/no disponible, sin inventar importes.

## 8. Cobertura adicional por módulo

Estas solicitudes son opcionales. Preparar los registros y estados antes del ensayo; confirmar individualmente cada escritura.

| Módulo | Prompt o acción | Verificar |
| --- | --- | --- |
| Directorio | «Busca a [PERSONA] y dime sus datos registrados». | Ficha de la persona. |
| Inmuebles | «Busca el inmueble por el domicilio [DOMICILIO] y resume lo registrado». | Ficha del inmueble; no inferir propiedad. |
| Cláusulas | «Muéstrame las cláusulas seleccionadas para [REFERENCIA] y sus versiones». | Selección y versiones aprobadas. |
| Revisión jurídica | «Registra una solicitud de cambios del documento [DOCUMENTO] del expediente [REFERENCIA], con comentario: [MOTIVO]». | Etapa compatible, confirmación y decisión humana persistida. |
| Firma | «Dime el estado de firma de [REFERENCIA] y el PDF asociado». | Proveedor manual y evidencia real de la aplicación. |
| Renovación | «Consulta los vencimientos y recordatorios de [REFERENCIA]». | Vigencia y ventanas del tablero. |
| Equipo | «Dime con qué usuario, organización y rol estoy conectado; lista integrantes si tengo permiso». | Identidad y roles visibles. |
| Administración | Con ADMIN: «Consulta la preparación del piloto y resume controles pendientes y bloqueantes». | Administración → Preparar prueba. |
| Aceptación | Con ADMIN: «Consulta el estado del lanzamiento y sus controles de aceptación pendientes». | Administración → Revisar y aprobar. |
| Portal | Crear enlace, captura, revisión e incorporación desde pantalla. | No se expone al asistente; enlace de un solo uso visible. |
| Tutorial | Abrir Aprender a usar la app. | Capacitación simulada, separada de las pruebas reales. |

## 9. Pruebas de control y recuperación

| Caso | Cómo probarlo | Resultado esperado |
| --- | --- | --- |
| CTRL-01. Permisos | Con VIEWER de prueba: «Crea un expediente titulado DEMO CLIENTE - Permisos 01». | No se crea ni obtiene permisos de escritura. |
| CTRL-02. Registro inexistente | «Busca el expediente DEMO CLIENTE - INEXISTENTE 999 y dime si existe». Antes, comprobar que no existe. | Informa ausencia; no inventa referencia o expediente. |
| CTRL-03. Ambigüedad | Preparar dos personas con nombres similares y pedir una actualización usando sólo el fragmento común. | Pide aclaración; no confirmar una propuesta cuyo destino sea dudoso. |
| CTRL-04. Workflow incompleto | Pedir DOCX en expediente sin requisitos completos. | Explica el bloqueo y no genera un contrato inventado. |
| CTRL-05. Lectura fallida | Si ocurre con el proveedor real, revisar si el original ya quedó guardado. | Ficha intacta; reintentar lectura, cambiar modo expresamente o capturar manualmente. |
| CTRL-06. Confirmación vencida | Sólo en ensayo: dejar caducar una propuesta. | No se ejecuta; preparar otra tras consultar estado. |

Si una confirmación devuelve error de red, consultar primero el módulo y su auditoría antes de repetir. Una operación puede haberse guardado aunque haya fallado su resumen. Para adjuntos vencidos hay que volver a adjuntar; para consultas extensas, dividir el trabajo o usar la continuación ofrecida.

## 10. Registro del ensayo

Estados: **Pendiente**, **Aprobado**, **Falló**, **No aplica**. No marcar aprobado por haber leído esta guía. Para cada caso guardar referencia del registro, captura o archivo de evidencia y resultado observado.

| Caso | Resultado | Evidencia / observación |
| --- | --- | --- |
| IA-01 Tareas y fechas | Pendiente | |
| IA-02 Búsqueda y seguimiento | Pendiente | |
| IA-03 Síntesis | Pendiente | |
| IA-04 Navegación | Pendiente | |
| IA-05 Dictado | Pendiente | |
| IA-06 Continuación | Pendiente | |
| IA-07 Cancelación y alta | Pendiente | |
| IA-08 Actualización | Pendiente | |
| IA-09 Datos ausentes | Pendiente | |
| IA-10 Expediente y tarea | Pendiente | |
| IA-11 Seguimiento y reprogramación | Pendiente | |
| IA-12 Lectura local | Pendiente | |
| IA-13 Adjunto con IA y guardado | Pendiente | |
| IA-14 Aplicar/rechazar campos | Pendiente | |
| IA-15 Lectura desde expediente | Pendiente | |
| IA-16 Resumen con fuentes | Pendiente | |
| IA-17 Inconsistencias | Pendiente | |
| IA-18 Clasificación sugerida | Pendiente | |
| IA-19 Comparación explicada | Pendiente | |
| IA-20 DOCX, PDF y descarga | Pendiente | |
| IA-21 Operación y auditoría | Pendiente | |
| IA-22 Consumo | Pendiente | |
| CTRL-01 a CTRL-06, registrar cada uno | Pendiente | |

**Cobertura aprobada = casos aprobados / casos aplicables acordados × 100.** Registrar también el total de casos no aplicables y sus motivos. Acordar el alcance antes del ensayo; un fallo dentro del alcance no se convierte en «No aplica» para mejorar el porcentaje.

## 11. Referencias de implementación

- [Asistente, confirmaciones y descargas](docs/ASSISTANT.md).
- [Lectura local y sus dependencias](docs/LECTURA_LOCAL.md).
- [Extracciones, adjuntos y revisión humana](docs/EXTRACCION_INE.md).
- [Análisis local y con IA](docs/ANALISIS_LOCAL_IA.md).
- [Presupuesto, consumo y conector IBM](docs/PRESUPUESTO_IA.md).
- [Tutorial y separación de la simulación](docs/TUTORIAL_INTERACTIVO.md).
- [Permisos vigentes](packages/domain/src/permissions.ts) y [transiciones](packages/domain/src/workflow.ts).

Las pruebas automatizadas con proveedores simulados comprueban integración y controles; la disponibilidad y compatibilidad del proveedor real requieren el ensayo anterior.
