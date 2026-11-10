# Presentación de Tabelio al cliente

**Guion operativo, casos de uso y prompts**  
**Versión:** 2 de noviembre de 2026  
**Duración sugerida:** 90 minutos con expedientes preparados; reservar 15 minutos para preguntas.  
**Guía de comprobación de IA:** [DEMOIA.md](DEMOIA.md)

## 1. Qué debe quedar claro al terminar

El cliente debe ver cómo Tabelio concentra personas, inmuebles, expedientes, documentos y seguimiento; cómo controla elaboración, revisión, firma y vigencias; y cómo la IA consulta información y prepara acciones verificables con autorización humana.

**Frase de apertura:**

> Hoy vamos a recorrer un asunto de arrendamiento desde su registro hasta la firma y el seguimiento. Veremos las pantallas y usaremos la IA sobre los mismos registros para comprobar sus respuestas y los cambios que autoricemos.

**Criterio de demostración:** los datos coinciden con las pantallas, las escrituras se confirman, los archivos se abren y cada caso tiene evidencia. «100 %» significa que todos los casos del alcance acordado fueron ensayados y aprobados. La precisión universal de la IA no se acredita con una presentación.

**Estado de este documento:** preparado mediante revisión de código y documentación. No se ejecutó la aplicación ni se modificaron sus datos al redactarlo. La preparación y el ensayo que aparecen abajo son actividades pendientes del presentador.

## 2. Preparar la reunión

### 2.1 Ambiente y acceso

Hacerlo antes de la reunión, en la organización de demostración.

1. Abrir una terminal en la carpeta del proyecto e iniciar el entorno ya instalado:

       npm run dev

2. Si es una instalación nueva, seguir primero [Inicio local del README](README.md): configurar el entorno privado, instalar dependencias y ejecutar la preparación inicial. No sobrescribir un archivo de entorno existente.
3. Abrir http://localhost:3000 e iniciar sesión. Credenciales iniciales publicadas para la demo local: admin@demo.local / Demo123!, organización demo-despacho. Si la contraseña ya cambió, usar la vigente.
4. Con la API activa, ejecutar en otra terminal:

       npm run demo:prepare

5. Entrar a **Tabelio IA**, enviar la consulta de tareas del caso 01 y contrastarla con Tareas.
6. Generar y abrir un PDF de prueba. Comprobar que LibreOffice está disponible.
7. Probar una lectura local y una lectura **Con IA** usando exclusivamente documentos ficticios legibles.
8. Comprobar el proveedor real del chat. El estado de salud de la API comprueba base/almacenamiento; no acredita disponibilidad del modelo ni lectura de imágenes.
9. Usar Chrome si se mostrará el conector IBM. Preparar la extensión y sesión W3 siguiendo [Presupuesto y consumo](docs/PRESUPUESTO_IA.md).
10. Preparar una ventana separada para Portal del cliente y otro perfil de navegador para VIEWER, si se mostrará la restricción de permisos.
11. Cerrar notificaciones y dejar abiertos únicamente los módulos y archivos de la demostración.

**No ejecutar durante la presentación:** smoke, pilot:check o launch:check. Son verificaciones técnicas que pueden crear datos QA, aplicar migraciones y ejecutar pruebas o compilaciones. Ejecutarlas previamente si forman parte del proceso de validación. No borran automáticamente todos los registros que crean.

### 2.2 Qué deja listo el comando de demo

| Expediente | Datos preparados |
| --- | --- |
| DEMO IA - Arrendamiento Alameda | Una tarea vencida y otra en curso a dos días. |
| DEMO IA - Arrendamiento Chapultepec | Una tarea vencida y otra a cinco días. |
| DEMO IA - Arrendamiento Providencia | Una tarea a catorce días y otra sin fecha límite. |

El resultado inicial esperado son **tres expedientes y seis tareas: dos vencidas, tres en plazo y una sin fecha**, asignadas a admin@demo.local. Si ya se modificaron, comprobarlos otra vez. El script fija las fechas relativas a las 18:00 UTC; se muestran según la zona de la interfaz.

**Este comando no integra contratos:** no añade partes, inmuebles, condiciones, archivos, aprobaciones ni firmas. Preparar los escenarios de la siguiente tabla desde la aplicación.

### 2.3 Escenarios que debes dejar preparados

No depender de terminar todo el ciclo por primera vez frente al cliente. Crear escenarios separados permite mostrar cada etapa con sus datos completos y conservar un caso nuevo para el alta en vivo.

| Alias del guion | Nombre sugerido | Dejar preparado | Se usa para |
| --- | --- | --- | --- |
| NUEVO | DEMO CLIENTE - Arrendamiento Olivo 01 | Se crea en vivo; sin datos inventados. | Alta, partes y checklist. |
| LISTO | DEMO CLIENTE - Contrato listo 01 | Arrendamiento completo en Listo para elaborar; requisitos y plantilla satisfechos. | DOCX, PDF y cláusulas. |
| VERSIONES | DEMO CLIENTE - Versiones 01 | Dos borradores DOCX distintos, última versión con PDF. | Diff y explicación con IA. |
| REVISION | DEMO CLIENTE - Revisión 01 | Borrador y PDF vigentes en Revisión. | Aprobación jurídica y final. |
| FIRMA | DEMO CLIENTE - Firma 01 | PDF aprobado, expediente en Firma y sin solicitud pendiente para iniciar una nueva. | Solicitud manual y activación. |
| RENOVAR | DEMO CLIENTE - Renovación 01 | Arrendamiento activo en ventana de vencimiento, sin renovación abierta. | Recordatorios y expediente relacionado. |
| TERMINAR | DEMO CLIENTE - Terminación 01 | Otro arrendamiento activo, sin renovación abierta. | Cancelar terminación y cierre con evidencia. |
| CONVENIO | DEMO CLIENTE - Convenio 01 | Convenio vinculado a arrendamiento completo, mediación y requisitos capturados. | Segundo tipo de expediente y DOCX de convenio. |
| PORTAL | DEMO CLIENTE - Portal 01 | Expediente editable con acceso a invitaciones. | Captura externa, revisión e incorporación. |
| CANCELAR | DEMO CLIENTE - Cancelación 01 | Expediente previo a activación, una tarea abierta y, si se ensaya, invitación pendiente. | Cancelación controlada y auditoría. |

Si un escenario no se preparó, marcarlo pendiente y completarlo antes de incluirlo como funcionalidad demostrada. Un caso incompleto sirve para enseñar bloqueos, pero no sustituye la generación exitosa de un contrato.

### 2.4 Datos ficticios que vas a utilizar

El sufijo **01** identifica esta sesión. Si ya existe, cambiarlo por **02** en todos los nombres y prompts relacionados.

| Dato | Valor sugerido |
| --- | --- |
| Persona creada en vivo | DEMO CLIENTE - Elena Torres 01; persona física, mexicana, arquitecta. |
| Arrendador preparado | DEMO CLIENTE - Mauricio Vega 01. |
| Obligada solidaria preparada | DEMO CLIENTE - Lucía Ríos 01. |
| Inmueble principal | DEMO CLIENTE - Casa Olivo 01. |
| Inmueble en garantía | DEMO CLIENTE - Garantía Encino 01. |
| Tarea nueva | DEMO CLIENTE - Revisar documentación 01. |
| Renta mensual / depósito / anticipada | 15,000 / 15,000 / 15,000 MXN. |
| Nota de seguimiento | Revisión realizada durante la presentación al cliente. |
| Motivo de reprogramación | Fecha acordada para recibir la documentación del cliente. |

No inventar identificadores oficiales ni domicilios para atribuirlos a personas reales. Si un campo es obligatorio para una plantilla, completarlo con el conjunto sintético que se haya preparado y revisado antes de la reunión.

**Hoja para llenar antes de presentar:**

| Variable | Valor real que usarás |
| --- | --- |
| [REF_NUEVO] | Anotar al crear NUEVO en vivo. |
| [REF_LISTO] | |
| [REF_VERSIONES] y [DOCX_VIGENTE] | |
| [REF_REVISION] | |
| [REF_FIRMA] | |
| [REF_RENOVAR] | |
| [REF_TERMINAR] | |
| [REF_CONVENIO] | |
| [REF_PORTAL] | |
| [REF_CANCELAR] | |
| [PERSONA_LECTURA] | Persona física ya vinculada al expediente de lectura. |
| [REF_LECTURA] | Puede ser NUEVO después de vincular a Elena, u otro caso editable. |
| [DOCUMENTO_LECTURA] | Nombre visible del archivo guardado. |
| [FECHA_CELEBRACION] | Fecha concreta solicitada por la plantilla. |
| [NUEVA_FECHA_TAREA] | Fecha y hora futuras con zona explícita. |
| [CUENTA_VIEWER] | Cuenta de prueba, sin escribir su contraseña en este archivo. |

Los corchetes son marcadores del guion: sustituirlos antes de pegar cada prompt. En las consultas genéricas, [REFERENCIA] y [DOCUMENTO] significan el caso y archivo que estés mostrando; [CAMPOS ELEGIDOS] son los campos concretos cotejados con el original. No enviar los alias LISTO o FIRMA como si fueran referencias reales.

### 2.5 Dejar el contrato listo para generar sin sorpresas

Preparar LISTO con estas condiciones verificadas en la plantilla de arrendamiento v1:

- Arrendador, arrendataria y obligada solidaria vinculados; datos necesarios de las fichas completos y género gramatical reconocido, como Señora/Señor.
- Inmueble principal y **también inmueble de garantía**, con acreditación textual de la garantía. La generación exige garantía aunque su requisito aparezca como no bloqueante.
- Condiciones capturadas: moneda MXN, renta, depósito, renta anticipada mayor que cero y forma/cuenta de pago.
- Plazo de doce meses; pago el día cinco; mantenimiento incluido.
- Aviso previo de treinta días, mora del cinco por ciento, sobreprecio del cincuenta por ciento y penalidad de dos meses, compatibles con la plantilla fija.
- Evidencias vigentes, correctamente clasificadas y asociadas; requisitos manuales revisados; cero requisitos bloqueantes pendientes.
- Cláusulas aprobadas seleccionadas antes de revisión.
- Avance permitido: Borrador → Integración → Validación → Listo para elaborar.
- Fecha de celebración preparada para generar el DOCX.

Revisar fechas de inicio/fin y duración en pantalla. No prometer cálculo de IVA: no existe ese campo en el formulario actual de condiciones.

Para CONVENIO, además:

- Vincular el arrendamiento correcto y conservar su inmueble principal y garantía, con acreditación textual de ambos.
- Completar las tres partes como personas físicas mexicanas: género, ciudad/estado de origen, estado civil, ocupación, domicilio/ciudad/estado, RFC y tipo/número de identificación con datos sintéticos revisados.
- Ciudad/estado de origen no se capturan en el formulario actual de Directorio: prepararlos previamente mediante el asistente con confirmación o una carga autorizada; también puede usarse un caso ya completo.
- Verificar condiciones compatibles del arrendamiento; forma/cuenta de pago de máximo noventa caracteres.
- Capturar número de convenio, número de expediente, audiencia con fecha/hora, centro y acreditación, facilitador y certificación, y al menos una copia.
- Satisfacer el checklist efectivo, incluido Contrato / Anexo 1 cuando corresponda. Generar indicando la fecha de celebración del arrendamiento.

### 2.6 Carpeta de archivos para la demostración

Preparar y abrir de antemano una carpeta con:

1. Identificación ficticia legible JPG/PNG/PDF y comprobante de domicilio ficticio.
2. Evidencia de propiedad y demás archivos requeridos por los escenarios.
3. Un archivo ya cargado y una copia con otro nombre para mostrar detección de duplicados.
4. Una segunda versión con contenido realmente distinto para mostrar renovación o versionado.
5. Un archivo de contrato firmado de demostración, distinto del PDF original.
6. Evidencia ficticia de terminación, distinta de los archivos ya cargados.

El sistema detecta archivos idénticos dentro del mismo expediente aunque cambien de nombre. Cambiar sólo el nombre no sirve para crear una nueva versión.

## 3. Orden y tiempos de la presentación

| Bloque | Casos | Minutos |
| --- | --- | ---: |
| Inicio, pendientes y búsqueda | 01–02 | 7 |
| Directorio, alta y checklist | 03–05 | 10 |
| Lectura local, IA y revisión | 06–07 | 12 |
| Análisis, documentos y cláusulas | 08–10 | 12 |
| Generación, comparación y aprobación | 11–13 | 13 |
| Firma y portal | 14–15 | 10 |
| Tareas, avisos, reportes y auditoría | 16–18 | 10 |
| Ciclo de vida y convenio | 19–20 | 7 |
| Administración, permisos, consumo y capacitación | 21–24 | 9 |
| **Total estimado** | | **90** |

Los casos con ciclos completos se apoyan en los escenarios preparados. No esperar en vivo a que transcurra un vencimiento o llegue un aviso externo.

## 4. Recorrido con pasos y prompts

### Caso 01. Empezar con una necesidad real: qué atender hoy

**Pantalla:** Tabelio IA, ruta /asistente.

**Di:**

> Antes de abrir expedientes, vamos a pedir un panorama del trabajo pendiente. Cada dato se puede verificar dentro de la aplicación.

**Haz:**

1. Mostrar el menú y entrar a Tabelio IA.
2. Pegar el prompt.
3. Abrir Tareas para contrastar la respuesta.

**Prompt:**

> Muéstrame mis tareas pendientes de los expedientes DEMO IA. Separa las vencidas, las que están en plazo y las que no tienen fecha límite. Incluye título, expediente, responsable, fecha y totales; indica si sólo muestras una selección.

**Debe verse:** los seis ejemplos preparados, con dos vencidas, tres en plazo y uno sin fecha, si no se alteraron. La tarea a catorce días también cuenta en plazo.

**Comprobación:** mismos títulos, expediente, responsable y fechas que en Tareas. Las diferencias en redacción de la IA no importan si los hechos coinciden.

### Caso 02. Encontrar un asunto, conservar contexto y abrirlo

**Pantalla:** Buscar y Tabelio IA.

**Haz:**

1. En Buscar, escribir una referencia o el nombre de un caso preparado.
2. Mostrar resultados agrupados y abrir su contexto.
3. En IA, enviar las siguientes solicitudes por separado.

**Prompts:**

> Muéstrame los tres primeros expedientes del listado disponible. Incluye referencia, título, estado y responsable. Explica el orden que utilizas.

> Del primero que acabas de mostrar, dime las partes registradas y los requisitos obligatorios pendientes.

> Resume esos pendientes en tres puntos para explicárselos a un cliente.

> Abre el expediente [REF_LISTO].

**Debe verse:** seguimiento coherente con el primer resultado, resumen fiel y navegación al expediente indicado.

**Di:** «Podemos preguntar con palabras habituales y después abrir la fuente para revisar el detalle».

### Caso 03. Registrar una persona con cancelación y confirmación

**Pantalla:** Directorio → Personas; chat flotante.

**Prompt:**

> Registra en el Directorio una persona física llamada DEMO CLIENTE - Elena Torres 01, de nacionalidad mexicana y ocupación arquitecta. No captures información que no te proporcioné.

**Haz:**

1. Mostrar la propuesta y pulsar **Cancelar**.
2. Buscar el nombre en Directorio: comprobar que no se creó.
3. Repetir la petición, revisar y **Confirmar**.
4. Buscar y abrir la ficha.
5. Enviar la actualización y confirmar.

**Prompt de actualización:**

> Cambia la ocupación de DEMO CLIENTE - Elena Torres 01 a ingeniera civil. Conserva los demás datos.

**Prompt para comprobar datos ausentes:**

> Dime el correo y la fecha de nacimiento registrados para DEMO CLIENTE - Elena Torres 01. Si no están capturados, indícalo.

**Debe verse:** no hay alta al cancelar; el alta confirmada existe; cambia sólo la ocupación y no se inventan correo o nacimiento.

**Di:** «La IA prepara la operación y nosotros revisamos qué se guardará».

### Caso 04. Vincular personas, inmueble y condiciones a un expediente

**Pantalla:** Directorio → Inmuebles; Expedientes.

**Haz:**

1. Mostrar las fichas preparadas de Casa Olivo y Garantía Encino; abrir **Editar** para enseñar datos y acreditación.
2. Crear NUEVO desde el chat.
3. Anotar su referencia como [REF_NUEVO].
4. Abrirlo y utilizar Resumen para vincular personas e inmueble preparados, seleccionar responsable y mostrar captura de condiciones.
5. Comparar con LISTO para mostrar un expediente integrado sin tener que rellenar todas las fichas en vivo.

**Prompt de creación:**

> Crea un expediente de arrendamiento titulado DEMO CLIENTE - Arrendamiento Olivo 01. No agregues inmuebles, partes ni condiciones que no te haya indicado.

**Prompt de consulta después de integrar:**

> Del expediente [REF_NUEVO], resume las partes, el inmueble, el responsable y las condiciones que estén registrados. Señala los datos que todavía faltan.

**Debe verse:** entidades reutilizables, relaciones claras y ausencia de datos inventados.

**Di:** «La información se registra en su ficha y se reutiliza en los asuntos relacionados».

### Caso 05. Entender el checklist y comprobar un bloqueo

**Pantalla:** Resumen → requisitos/checklist.

**Haz:**

1. Mostrar requisitos automáticos y manuales, obligatorios y bloqueantes.
2. En NUEVO, avanzar sólo por las etapas que permitan sus reglas.
3. Intentar pasar de Validación a Listo para elaborar con bloqueantes pendientes, si ya se ensayó ese estado.
4. Mostrar el mensaje y consultar las causas en IA.
5. En LISTO, mostrar el checklist satisfecho.

**Prompt:**

> Del expediente [REF_NUEVO], enumera los requisitos obligatorios pendientes y explica cuáles bloquean avanzar a listo para elaborar. Utiliza la información registrada.

**Debe verse:** bloqueo coherente con los requisitos. El primer avance desde Borrador puede estar permitido; no usarlo como única prueba de bloqueo.

**Di:** «El checklist y el semáforo siguen reglas de la aplicación; la IA nos ayuda a explicar sus causas».

No dispensar requisitos sólo para acelerar la presentación. Si se muestra una dispensa, utilizar un ejemplo previsto, motivo explícito y perfil autorizado.

### Caso 06. Comparar lectura local y lectura con IA

**Pantalla:** Tabelio IA → Adjuntar documentos.

**Haz primero la alternativa local:**

1. Anotar las llamadas de IA visibles en el panel de consumo.
2. Elegir **Sin IA · local**, adjuntar un archivo ficticio y enviar.
3. Mostrar texto/campos reconocidos.
4. Comprobar que no se guardó en un expediente ni cambió una persona y que esa lectura no generó llamadas de IA.

**Luego demuestra IA:**

1. Elegir **Con IA** y adjuntar identificación ficticia.
2. Usar una persona ya vinculada a [REF_LECTURA].
3. Enviar:

> Esta identificación corresponde a [PERSONA_LECTURA], quien ya está registrada como arrendataria en el expediente [REF_LECTURA]. Muéstrame los datos visibles y prepara su guardado como identificación de esa arrendataria.

4. Mostrar tipo y campos preliminares, revisar destino y cancelar una propuesta.
5. Comprobar que no se guardó. Preparar otra vez la carga y confirmar; volver a adjuntar si fuera necesario.
6. Abrir Documentos y Directorio.

**Debe verse:** documento y lectura pendiente después de confirmar; la ficha de la persona todavía sin cambios por ese guardado.

**Di:** «La lectura local no usa el proveedor de IA. Ahora seleccionamos expresamente IA y revisamos lo leído antes de conservarlo».

Hasta tres PDF/JPG/PNG por mensaje, 20 MB por archivo. La lectura preliminar no certifica autenticidad. Los resultados locales del chat no se incorporan automáticamente a la conversación de IA ni guardan el original en el expediente.

### Caso 07. Revisar y aplicar sólo los campos autorizados

**Pantalla:** Extracciones, ruta /extracciones.

**Haz:**

1. Abrir la extracción del documento y **Ver original**.
2. Comparar nombre y domicilio; corregir errores si los hay.
3. Seleccionar sólo los campos deseados. Para sustituir un dato existente distinto, marcar **Autorizo reemplazar el dato existente**.
4. Escribir un comentario de al menos diez caracteres.
5. Pulsar **Confirmar y guardar campos seleccionados**.
6. Abrir Directorio y verificar.
7. En otra extracción preparada, mostrar **Rechazar extracción** y comprobar que no cambia la persona.

**Alternativa con el chat, para la segunda confirmación:**

> Registra la revisión de la extracción pendiente de la identificación [DOCUMENTO_LECTURA] del expediente [REF_LECTURA] para [PERSONA_LECTURA]. Compara los datos con su ficha y prepara aplicar únicamente [CAMPOS ELEGIDOS]; explica cualquier valor existente que se reemplazaría. Usa el comentario: Datos cotejados con el original durante la demostración.

Usar pantalla o chat para aplicar los campos; no repetir ambas escrituras sobre el mismo resultado.

**Debe verse:** original, datos propuestos, selección humana, revisión persistida y ficha actualizada sólo en los campos aprobados.

### Caso 08. Obtener resumen e inconsistencias con fuentes

**Pantalla:** Expediente → Resumen → Análisis del expediente.

**Haz:**

1. Ejecutar el resumen en **Sin IA · reglas locales**.
2. Cambiar a **Con IA** y ejecutar; mostrar fecha, fuentes y límites.
3. Ejecutar la revisión de inconsistencias.
4. Abrir una fuente o dato del expediente para contrastarlo.

**Prompts alternativos desde el chat:**

> Genera con IA un resumen del expediente [REF_LISTO]. Cita las fuentes consultadas, identifica datos faltantes e indica cualquier límite de cobertura.

> Revisa con IA las inconsistencias del expediente [REF_LISTO]. Distingue diferencias confirmadas de datos ausentes y cita sus fuentes. Indica qué debe revisar una persona.

**Debe verse:** explicaciones apoyadas en el expediente. Un caso sin inconsistencias debe indicarlo; no necesita inventar hallazgos. Los análisis no alteran estados ni el semáforo.

**Di:** «La explicación muestra en qué datos se apoya y hasta dónde pudo revisar».

### Caso 09. Administrar documentos, versiones y clasificación sugerida

**Pantalla:** Expediente → Documentos; repositorio Documentos.

**Haz:**

1. Mostrar **Carga documental múltiple**: tipo, persona/inmueble y vigencia por archivo.
2. Explicar el selector **Lectura al guardar**: Guardar sin leer, Leer localmente (sin IA), Leer con IA cuando esté habilitado.
3. Intentar cargar la copia idéntica preparada con otro nombre: comprobar el rechazo por duplicado.
4. Mostrar una versión distinta y el historial; distinguir la versión operativa de las anteriores.
5. En un documento ordinario con texto legible, desplegar **Analizar clasificación**; en el panel **Clasificación sugerida**, elegir **Con IA** y pulsar **Analizar clasificación con IA**.
6. Mostrar **Usar sugerencia**, revisar el formulario y guardar la corrección únicamente si corresponde.
7. En el repositorio central, mostrar filtros por vigencia.
8. En un archivo prescindible de prueba, invalidar con motivo y restaurar; comprobar su efecto en checklist e historial.

**Prompt de clasificación:**

> Sugiere con IA la clasificación del documento [DOCUMENTO_LECTURA] del expediente [REF_LECTURA], sin guardar cambios.

**Debe verse:** sugerencia sin reclasificación automática, duplicado rechazado y archivos históricos conservados. El máximo de un lote es diez archivos. No hacer eliminación irreversible en vivo si invalidar y restaurar cubren el caso.

### Caso 10. Incorporar cláusulas aprobadas

**Pantalla:** Cláusulas y Resumen del expediente LISTO.

**Haz:**

1. Abrir una cláusula preparada y mostrar sus versiones y aprobación.
2. Con ADMIN, mostrar dónde se aprueba una versión de prueba, si se incluyó en el ensayo.
3. En LISTO, seleccionar la versión aprobada y **Guardar selección**.
4. Explicar que el documento generado conserva una copia de esa versión.

**Prompt:**

> Muéstrame las cláusulas seleccionadas para el expediente [REF_LISTO] y sus versiones.

**Debe verse:** la selección coincide con el expediente. Prepararla antes de entrar en revisión; en esa etapa la selección queda bloqueada.

### Caso 11. Generar un contrato y abrir su PDF

**Pantalla:** Documentos del expediente LISTO; chat flotante.

**Haz:**

1. Mostrar estado Listo para elaborar y checklist.
2. Enviar la petición de DOCX, revisar y confirmar.
3. Mostrar versión y descargar el resultado.
4. Pedir PDF en otra operación, confirmar y abrir **Vista previa**.
5. Abrir el PDF para que el cliente vea datos y cláusulas.

**Prompts:**

> Genera el borrador del contrato de arrendamiento del expediente [REF_LISTO] con la plantilla, datos y cláusulas registrados. Usa como fecha de celebración [FECHA_CELEBRACION].

> Genera la vista previa PDF del último borrador DOCX del expediente [REF_LISTO].

> Dame el botón de descarga del último PDF del expediente [REF_LISTO], sin generar otra versión.

**Debe verse:** archivos reales, PDF vinculado al DOCX vigente y descarga autenticada.

**Di:** «La IA solicita la generación. El contrato utiliza la plantilla jurídica aprobada y los datos capturados; después se convierte a PDF».

Si faltan condiciones de la plantilla, corregirlas antes de la reunión. No prometer que la IA redacta libremente el contrato del caso.

### Caso 12. Comparar dos versiones y explicar los cambios

**Pantalla:** Documentos del expediente VERSIONES.

**Haz:**

1. Abrir **Comparar anterior** del DOCX vigente.
2. Mostrar los párrafos añadidos, eliminados o modificados.
3. Seleccionar **Con IA** en la explicación y ejecutar.
4. Contrastar un cambio concreto de la explicación con el diff.

**Prompt alternativo:**

> Explica con IA los cambios entre el borrador DOCX [DOCX_VIGENTE] del expediente [REF_VERSIONES] y su versión anterior. Cita los párrafos y utiliza la comparación exacta como referencia.

**Debe verse:** explicación vinculada a cambios de texto reales. No compara diseño, firmas o imágenes y puede acotar la cantidad de párrafos explicados.

### Caso 13. Revisión jurídica y aprobación final

**Pantalla:** Documentos del expediente REVISION.

**Haz:**

1. Mostrar el DOCX/PDF vigente y su historial.
2. Escribir un comentario humano y pulsar **Aprobar jurídicamente** con LAWYER o ADMIN.
3. Mostrar la etapa de aprobación.
4. Con ADMIN, escribir comentario y pulsar **Aprobar para firma**.
5. Comprobar estados e historial.

**Prompt opcional para mostrar una devolución, en otro expediente preparado:**

> Registra una solicitud de cambios en la revisión jurídica del documento [DOCUMENTO] del expediente [REFERENCIA], con el comentario: Confirmar la forma de pago antes de aprobar esta versión.

**Debe verse:** decisiones humanas registradas con autor/fecha. Si se solicitan cambios, hay que generar una nueva versión antes de reenviar a revisión.

**Di:** «La revisión jurídica y la aprobación final son decisiones separadas. La IA registra una decisión que la persona autorizada indicó expresamente».

### Caso 14. Firma manual y activación

**Pantalla:** Expediente FIRMA → Documentos/firma.

**Haz:**

1. Mostrar el PDF aprobado.
2. Pulsar **Iniciar firma** y revisar la solicitud. Si ya existe una pendiente, utilizarla en lugar de iniciar otra.
3. Capturar la fecha y notas y cargar el archivo ficticio firmado.
4. Pulsar **Registrar firma y activar**.
5. Comprobar contrato firmado, fecha de firma, evidencia documental, historial y estado activo.

**Prompt de consulta:**

> Dime el estado de firma del expediente [REF_FIRMA] y qué documento está asociado al proceso.

**Debe verse:** solicitud vinculada al PDF y activación por la copia firmada.

**Di:** «En esta instalación el proceso de firma es manual: registramos la solicitud y conservamos la copia firmada. El proveedor electrónico externo requiere su integración».

### Caso 15. Portal del cliente y revisión interna

**Pantalla:** Resumen de PORTAL → Portal del cliente.

**Haz:**

1. Seleccionar rol y, si corresponde, persona; indicar correo de referencia y vigencia.
2. Pulsar **Crear enlace seguro** y **Copiar enlace**. El enlace sólo se muestra una vez; conservarlo de forma privada durante el ensayo.
3. Abrirlo en una ventana separada y mostrar la experiencia del cliente sin cuenta interna.
4. Capturar datos ficticios, pulsar **Guardar información**, cargar una identificación ficticia nueva y clasificarla según el rol invitado; después pulsar **Enviar a revisión**. Un comprobante u Otro no sustituyen la identificación requerida.
5. Regresar a la sesión interna, recargar el expediente y mostrar la tarea automática de revisión.
6. Revisar datos y documentos, pulsar **Incorporar** y escribir un comentario de al menos diez caracteres. Si se ensayó un segundo caso, mostrar **Solicitar ajustes**, también con comentario obligatorio.
7. Comprobar persona, rol y documentos incorporados, así como el cierre de la tarea de revisión.

**Debe verse:** la captura externa espera aceptación interna; no modifica silenciosamente el Directorio.

**Di:** «El cliente aporta información y el despacho decide qué incorporar».

El portal se opera desde pantalla; el asistente no expone invitaciones ni tokens. Crear el enlace no significa enviar un correo automático.

### Caso 16. Convertir una indicación en trabajo con seguimiento

**Pantalla:** Tareas y Tareas del expediente NUEVO.

**Prompt de alta:**

> En el expediente [REF_NUEVO], crea una tarea titulada DEMO CLIENTE - Revisar documentación 01, asignada a mi usuario, con prioridad alta y sin fecha límite.

**Haz:**

1. Confirmar y abrir la tarea.
2. Mostrar filtros, responsable y prioridad; pulsar **Iniciar**.
3. **Bloquear** con motivo «Esperando documentación acordada con el cliente»; mostrar responsable y antigüedad del bloqueo.
4. **Retomar**.
5. Agregar nota y reprogramar con prompts separados, confirmando cada uno.
6. Si se preparó, mostrar una tarea con evidencia requerida y otra con prerrequisito: no se completa hasta cumplirlos.

**Prompts:**

> Agrega a la tarea DEMO CLIENTE - Revisar documentación 01 del expediente [REF_NUEVO] la nota: Revisión realizada durante la presentación al cliente.

> Reprograma la tarea DEMO CLIENTE - Revisar documentación 01 del expediente [REF_NUEVO] al [NUEVA_FECHA_TAREA], con motivo: Fecha acordada para recibir la documentación del cliente.

**Debe verse:** tarea real, notas con autor/fecha e historial de fechas. El bloqueo por evidencia/prerrequisito tiene causa visible.

### Caso 17. Avisos personales, vencimientos y reporte de operación

**Pantallas:** Avisos, Tareas y Reportes.

**Haz:**

1. En Avisos, abrir una asignación pendiente y **Marcar atendido**.
2. Mostrar en Tareas los filtros vencidas, próximas y sin fecha; carga por responsable y bloqueos.
3. En un documento de prueba con vigencia en riesgo, mostrar la tarea automática y su responsable. La renovación de la evidencia resuelve la tarea automática.
4. En Reportes, elegir Desde/Hasta, pulsar **Actualizar** y, con permiso, **Exportar CSV**.
5. Comparar con el resumen de IA.

**Prompts:**

> Muéstrame mis avisos pendientes e indica a qué expediente o tarea corresponde cada uno.

> Consulta el reporte operativo de los últimos 30 días. Indica el periodo y resume tareas atrasadas, carga por responsable y bloqueos. Distingue métricas del periodo de la situación actual.

**Debe verse:** avisos de la cuenta activa, cifras coincidentes y archivo exportado. Correo y calendario requieren proveedores; los avisos internos sí son parte de este recorrido.

### Caso 18. Demostrar trazabilidad de una operación real

**Pantalla:** Actividad del expediente NUEVO y Auditoría con ADMIN.

**Haz:**

1. Buscar la tarea o actualización recién confirmada.
2. Mostrar acción, fecha y responsable.
3. Filtrar por expediente y periodo.
4. Si está previsto, exportar la bitácora.

**Prompt:**

> Consulta la bitácora del expediente [REF_NUEVO] y resume los movimientos recientes, con fecha, acción y responsable.

**Debe verse:** el cambio que se hizo durante la reunión tiene su registro. No usar el texto del chat como única evidencia de que una escritura quedó guardada.

### Caso 19. Renovación, terminación y cancelación

Usar los tres escenarios separados de la preparación.

**RENOVAR:**

1. Mostrar vigencia y ventanas de 90/60/30/15 días.
2. Mostrar recordatorio; elegir un nuevo inicio posterior al fin del contrato actual y un fin posterior a ese inicio. Revisar renta y duración y pulsar **Iniciar renovación**.
3. Abrir el nuevo expediente relacionado y comprobar partes, inmuebles y condiciones reutilizadas; las evidencias deben reconfirmarse.

**TERMINAR:**

1. Capturar motivo y fecha efectiva → **Iniciar terminación**.
2. Mostrar **Cancelar terminación** con motivo y comprobar recuperación de la etapa anterior.
3. Si se incluyó el cierre en el ensayo, iniciar otra vez y cargar evidencia nueva → **Registrar evidencia y cerrar**.
4. Comprobar estado cerrado y documento de cierre.

**CANCELAR:**

1. En el caso previo a activación, cancelar con motivo explícito.
2. Comprobar que queda consultable y auditado, con tareas abiertas canceladas y accesos pendientes cerrados según corresponda.

**Prompt de apoyo:**

> Resume el estado, vigencia, recordatorios y procesos de renovación o terminación registrados en el expediente [REFERENCIA].

**Debe verse:** renovación relacionada, cierre con evidencia y cancelación motivada. No iniciar renovación y terminación sobre el mismo expediente durante la demo: una renovación abierta puede bloquear la terminación.

### Caso 20. Convenio de mediación relacionado con el arrendamiento

**Pantalla:** Expediente CONVENIO.

**Haz:**

1. Mostrar tipo Convenio de mediación y contrato relacionado.
2. Abrir datos de audiencia, centro, facilitador, número de convenio y copias.
3. Mostrar partes e inmuebles relacionados y el checklist específico.
4. Con el caso preparado y listo para elaborar, generar DOCX y PDF como operaciones separadas.
5. Abrir los archivos.

**Prompt:**

> Genera el borrador del convenio del expediente [REF_CONVENIO] con los datos registrados. Usa como fecha de celebración del arrendamiento [FECHA_CELEBRACION].

**Después de confirmar:**

> Genera la vista previa PDF del último borrador DOCX del expediente [REF_CONVENIO].

**Debe verse:** segundo flujo documental y relación con el arrendamiento. Si la plantilla rechaza datos, explicar el requisito; resolverlo previamente para presentar una generación exitosa.

### Caso 21. Requisitos, equipo y permisos

**Pantallas:** Requisitos y Equipo.

**Haz:**

1. En Requisitos, mostrar tipo, rol aplicable, orden, bloqueo y vigencia de una definición.
2. Explicar el snapshot histórico: cambiar el catálogo afecta futuros expedientes; los existentes conservan su checklist.
3. En Equipo, mostrar cuentas y roles.
4. Cambiar a la sesión VIEWER de prueba y enviar el prompt restringido.
5. Regresar a ADMIN.

**Prompt para comprobar identidad:**

> Dime con qué usuario, organización y rol estoy conectado.

**En VIEWER:**

> Crea un expediente de arrendamiento titulado DEMO CLIENTE - Permisos 01.

**Debe verse:** VIEWER no crea el registro ni adquiere permisos a través de la IA.

| Perfil | Alcance relevante para explicar |
| --- | --- |
| ADMIN | Todos los permisos, aprobación final, auditoría y administración. |
| LAWYER | Elaboración, revisión jurídica, firma/ciclo de vida y reportes; sin aprobación final ni administración. |
| OPERATOR | Captura de Directorio, expedientes, documentos y tareas; consulta de reportes. |
| VIEWER | Lectura de los módulos permitidos. |

No cambiar el rol de la única cuenta administradora durante la reunión.

### Caso 22. Administración y puesta en marcha

**Pantalla:** Administración → Puesta en marcha, con ADMIN.

**Haz:**

1. Abrir **Preparar prueba**: diagnóstico, controles y preparación.
2. Abrir **Gestionar participantes y seguimiento**: migración, capacitación, conciliación, incidencias y ciclos.
3. Abrir **Revisar y aprobar**: aceptación, integraciones, seguridad, métricas y decisión GO/NO-GO.
4. Mostrar controles existentes; no registrar una decisión final de aceptación sólo para probar un botón.

**Prompts de consulta:**

> Consulta la preparación del piloto y resume los controles pendientes, los bloqueantes y las evidencias registradas.

> Consulta el estado del lanzamiento y resume las pruebas de aceptación y controles pendientes.

**Debe verse:** un proceso administrativo trazable. Los simuladores locales de OCR/firma/correo/calendario no acreditan proveedores externos y estas pantallas no despliegan infraestructura.

### Caso 23. Consumo visible, dictado y acceso móvil

**Pantalla:** Tabelio IA → Presupuesto y consumo.

**Haz:**

1. Mostrar **Este chat**, **Última operación** y consumo personal; abrir detalle de llamadas y tokens.
2. Relacionar una operación reciente con lo que se acaba de ejecutar.
3. Si está conectado IBM, pulsar **Actualizar** y mostrar fecha y alcance del saldo.
4. Dictar «Muéstrame mis tareas pendientes», revisar la transcripción y enviar.
5. Si se preparó el teléfono, abrir **Llévalo en tu móvil**, escanear QR e iniciar sesión con su cuenta.

**Debe verse:** las operaciones de IA tienen medición; las lecturas/análisis locales no generan llamadas de IA.

**Di:**

> El panel distingue las llamadas y tokens registrados de un saldo IBM. Si el importe se calcula con una tarifa de referencia, se muestra como estimado.

Los **Advantage Credits** no se suman a USD/MXN. El saldo del conector depende de la sesión W3 en el mismo perfil de Chrome y del origen http://localhost:3000. Un dato desactualizado debe conservar esa indicación.

El teléfono debe estar en la misma Wi-Fi; el QR no sustituye la autenticación. Para dictado móvil preparar antes HTTPS confiable y navegador compatible; el chat por HTTP local puede usarse con teclado.

### Caso 24. Capacitación, cuenta y cierre

**Pantallas:** Aprender a usar la app y Mi cuenta.

**Haz:**

1. Abrir **Aprender a usar la app**.
2. Mostrar índice, **Iniciar demostración**, **Iniciar práctica**, pausa y retoma.
3. Explicar que el contenido se adapta al perfil y guarda el progreso.
4. Abrir Mi cuenta para mostrar el acceso a cambio de contraseña y cierre de sesión, sin cambiar las credenciales durante la reunión.
5. Volver al expediente trabajado y a su actividad para cerrar con un resultado real.

**Di:**

> El equipo tiene un recorrido de capacitación para practicar con ejemplos. Lo que acabamos de comprobar en los módulos reales queda en expedientes, documentos y actividades verificables.

El tutorial ADMIN contiene 24 capítulos y 114 pasos en la versión actual. Es una simulación del navegador: no guarda expedientes ni llama a IA, OCR o IBM. La evidencia funcional de esta reunión debe provenir de los casos ejecutados en la aplicación real.

## 5. Versión breve de veinte minutos

Usar los escenarios preparados; no intentar completar todos los formularios.

| Minutos | Qué mostrar | Caso del guion |
| --- | --- | --- |
| 0–2 | Tareas reales consultadas con IA. | 01 |
| 2–5 | Expediente, partes, checklist y resumen con IA. | 04, 05, 08 |
| 5–8 | Identificación ficticia: lectura con IA, confirmación de guardado y revisión humana. | 06, 07 |
| 8–11 | Generar contrato y abrir PDF; mostrar comparación preparada. | 11, 12 |
| 11–13 | Doble aprobación y firma manual sobre escenarios ya listos. | 13, 14 |
| 13–16 | Tarea creada por IA, nota y auditoría. | 16, 18 |
| 16–18 | Portal y reporte con ejemplos preparados. | 15, 17 |
| 18–20 | Permisos, consumo y cierre. | 21, 23, 24 |

Este recorrido es una selección. No describir módulos omitidos como comprobados durante esos veinte minutos.

## 6. Si algo falla durante la presentación

| Situación | Qué hacer | Qué decir |
| --- | --- | --- |
| Chat no responde o proveedor indisponible | Guardar el error, comprobar si hubo acción y seguir el recorrido de pantallas. Reintentar luego. | «El proveedor no respondió en este intento; revisemos el estado real de la operación». |
| Respuesta contiene un dato que no coincide | Abrir la fuente, señalar la discrepancia y registrar el caso como fallido. | «Este dato requiere corrección; lo contrastamos con el registro». |
| La IA pide aclaración | Dar referencia, nombre completo, rol o documento exacto. | «Hay más de una coincidencia; confirmamos el registro antes de modificarlo». |
| Confirmación caducada | Consultar si existe el cambio y preparar una propuesta nueva. | «La autorización tiene vigencia limitada; vamos a revisarla otra vez». |
| Adjunto vencido | Volver a adjuntar; no reiniciar la API en medio del flujo. | «El archivo temporal venció antes de su confirmación». |
| Original guardado y lectura fallida | Reintentar **Leer o capturar…** desde el documento. | «El archivo está conservado; sólo falta repetir o capturar la lectura». |
| OCR/IA leyó mal un campo | Corregirlo comparando el original antes de aplicar. | «Por eso revisamos y elegimos los campos antes de actualizar la ficha». |
| Faltan datos para DOCX | Mostrar el requisito; usar LISTO si el problema es del escenario nuevo. | «Este expediente sigue incompleto; el control evita generar con esos datos faltantes». |
| PDF falla | Revisar LibreOffice después; usar una vista previa preparada, explicando que ya existía. | «La conversión de este intento no terminó; este es el PDF generado durante el ensayo». |
| Presupuesto IBM no disponible | Mostrar llamadas/tokens y el estado del conector; no inventar saldo. | «El consumo registrado está disponible; el saldo requiere reconectar IBM». |
| Voz no compatible | Escribir el mismo prompt. | «El dictado depende de este navegador; el chat acepta la misma solicitud por teclado». |

No marcar aprobado un caso fallido porque se mostró una captura anterior o una simulación. La recuperación permite continuar la presentación; el fallo se conserva en el registro.

## 7. Ensayo y evidencias antes de presentar

Marcar **Aprobado** sólo después de ejecutarlo y comparar el resultado. Si un caso no forma parte de la reunión, acordar su exclusión antes del ensayo.

| Caso | Estado inicial | Evidencia mínima |
| --- | --- | --- |
| 01 Tareas con IA | Pendiente | Respuesta y lista filtrada coincidentes. |
| 02 Búsqueda y contexto | Pendiente | Referencia y seguimiento correcto. |
| 03 Alta cancelada/confirmada | Pendiente | Ausencia al cancelar; ficha al confirmar. |
| 04 Integración de expediente | Pendiente | Referencia, partes, inmueble y condiciones. |
| 05 Checklist y bloqueo | Pendiente | Mensaje y requisito correspondiente. |
| 06 Lectura local y con IA | Pendiente | Original, campos, destino y consumo. |
| 07 Revisión de extracción | Pendiente | Campos aplicados y revisión persistida. |
| 08 Resumen e inconsistencias | Pendiente | Fuentes y cotejo con datos. |
| 09 Documentos y clasificación | Pendiente | Duplicado rechazado, historial y sugerencia. |
| 10 Cláusulas | Pendiente | Versión aprobada seleccionada. |
| 11 DOCX/PDF | Pendiente | Archivos descargados y PDF abierto. |
| 12 Comparación | Pendiente | Diff y explicación coincidentes. |
| 13 Revisión y aprobación | Pendiente | Historial de decisiones. |
| 14 Firma y activación | Pendiente | Copia firmada y estado activo. |
| 15 Portal | Pendiente | Captura revisada e incorporación. |
| 16 Tareas | Pendiente | Alta, bloqueo, nota y fechas. |
| 17 Avisos y reportes | Pendiente | Pantalla y CSV del periodo. |
| 18 Auditoría | Pendiente | Evento de una escritura de la reunión. |
| 19 Ciclo de vida | Pendiente | Renovación relacionada y cierre/cancelación motivados. |
| 20 Convenio | Pendiente | Relación y documentos generados. |
| 21 Permisos | Pendiente | VIEWER sin alta; identidad correcta. |
| 22 Administración | Pendiente | Controles y estado consultados. |
| 23 Consumo/voz/móvil incluidos | Pendiente | Medición y comprobación de cada opción elegida. |
| 24 Capacitación y cuenta | Pendiente | Tutorial y cuenta visibles. |

**Checklist final del presentador:**

- [ ] Organización demo y cuenta ADMIN correctas.
- [ ] Referencias y nombres de documento anotados.
- [ ] Prompts con marcadores reemplazados.
- [ ] Archivos sintéticos disponibles y legibles.
- [ ] LISTO genera DOCX/PDF con la plantilla vigente.
- [ ] VERSIONES tiene diferencias reales de texto.
- [ ] REVISION y FIRMA están en etapas correctas.
- [ ] Proveedor real probado con texto e identificación ficticia.
- [ ] Confirmaciones de guardado y de aplicación de campos ensayadas.
- [ ] Conteos de tareas contrastados después de preparar la demo.
- [ ] Portal, ventanas de roles y extensión IBM preparados si se mostrarán.
- [ ] Evidencia y resultado real registrados para cada caso del alcance.
- [ ] Casos fallidos resueltos o comunicados antes de prometer cobertura completa.

**Frase de cierre:**

> Hemos comprobado cómo se registra y sigue un asunto, cómo se controla la documentación y cómo la IA ayuda a consultar, explicar y preparar operaciones. Cada cambio autorizado tiene un resultado visible y un historial que podemos revisar.

## 8. Fuentes para preparar y ampliar la demo

- [DEMO IA: prompts y pruebas detalladas](DEMOIA.md).
- [Arranque y alcance actual](README.md).
- [Asistente y confirmaciones](docs/ASSISTANT.md).
- [Lectura local](docs/LECTURA_LOCAL.md).
- [Adjuntos, INE y revisión humana](docs/EXTRACCION_INE.md).
- [Cuatro análisis local/IA](docs/ANALISIS_LOCAL_IA.md).
- [Presupuesto y consumo](docs/PRESUPUESTO_IA.md).
- [Capacitación interactiva](docs/TUTORIAL_INTERACTIVO.md).
- [Permisos del código actual](packages/domain/src/permissions.ts).
- [Reglas de generación de documentos](apps/api/src/documents/documents.service.ts).

Ante diferencias con documentos históricos de alcance, verificar permisos, validaciones y etiquetas de la versión que se presentará.
