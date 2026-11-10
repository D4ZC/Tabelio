# Lectura de INE con revisión humana

## Alcance

La aplicación ofrece ahora **lectura local sin proveedor de IA** como opción predeterminada y **lectura con IA** por selección explícita. Consulta [Lectura local y con IA](LECTURA_LOCAL.md) para instalación, límites y uso. Las instrucciones de activación del proveedor de este documento corresponden exclusivamente al modo con IA.

El flujo es **guardar archivo → leer datos visibles → revisar y corregir → confirmar campos → actualizar ficha**. No hay cambios automáticos al Directorio después de subir la imagen. No se verifica autenticidad, identidad, firma, fotografía ni vigencia de la credencial.

- Tipos documentales: identificación de arrendador (`LANDLORD_ID`), arrendatario (`TENANT_ID`) y obligado solidario (`GUARANTOR_ID`). Sólo se transcriben INE/IFE; otros documentos mantienen captura manual.
- Formatos de lectura: JPG, PNG y PDF, hasta 20 MB por archivo. Un HEIC o Word puede conservarse como evidencia, pero no se envía a lectura automática.
- Campos posibles: nombre completo, nombres, apellidos, CURP, fecha de nacimiento, sexo/género impreso, calle y número, colonia/complemento, ciudad o municipio, estado, código postal, tipo de identificación y CIC si aparece expresamente.
- Los campos ausentes o dudosos se omiten. No se deducen nacimiento o género a partir de la CURP ni se completan domicilios por códigos o conocimiento externo.
- Se actualiza una persona física existente de la misma organización. Si falta, regístrala primero en Directorio; la extracción no crea personas ni cambia roles del expediente por su cuenta.

## Activación

1. Desde la raíz del proyecto, aplica las migraciones antes de iniciar esta versión:

   ```bash
   npm run db:deploy
   npm run db:generate
   ```

   La migración `20261029000000_identity_curp` agrega una columna CURP opcional a `Person`. No borra datos ni requiere volver a sembrar la base. Es necesaria incluso si dejas desactivada la lectura con IA, porque el cliente Prisma de esta versión incluye ese campo.

2. Conserva en `.env` la configuración privada del proveedor del asistente (`ASSISTANT_API_BASE_URL`, `ASSISTANT_API_KEY`, `ASSISTANT_MODEL` y encabezados correspondientes). Agrega o cambia:

   ```dotenv
   ASSISTANT_ENABLED=true
   DOCUMENT_EXTRACTION_ENABLED=true
   ```

   No pongas credenciales en variables `NEXT_PUBLIC_*`. El proveedor y el modelo deben admitir imágenes y salida JSON con esquema estricto en Responses API; para PDF también deben admitir `input_file`. Una API compatible sólo con texto no basta. La configuración existente no garantiza estas capacidades: se comprueban en una prueba controlada con datos ficticios.

3. Reinicia la API para releer `.env` y recarga la web. Para desarrollo local puedes detener el proceso anterior y ejecutar `bash scripts/local-dev.sh`, que carga el entorno y verifica migraciones antes de iniciar API y web. No ejecutes dos servidores sobre los mismos puertos.

4. Verifica, con sesión autenticada, `GET /api/documents/extraction-settings`: debe indicar `enabled: true`, el host del proveedor y los formatos admitidos. `enabled` confirma configuración, no una prueba de disponibilidad o compatibilidad del modelo.

Sin activación, sin asistente habilitado o sin clave, están disponibles la lectura local y la captura manual. `DOCUMENT_EXTRACTION_ENABLED=false` desactiva nuevos envíos de identificaciones a IA sin borrar archivos ni revisiones existentes.

## Uso desde un expediente

1. En Directorio, registra la persona de prueba y vincúlala al expediente con su rol.
2. En **Documentos**, utiliza **Carga documental múltiple**, disponible en la parte superior. Selecciona la imagen o PDF, el tipo de identificación correspondiente y la persona relacionada.
3. Selecciona el modo de lectura: guardar sin leer, lectura local o lectura con IA. El modo local no utiliza el proveedor. Si eliges IA, lee el aviso del proveedor antes de enviar.
4. Al guardar un único archivo leído correctamente se abre su revisión en **Extracciones**. En lotes se muestran resultados y enlaces por archivo. Los archivos se guardan antes de enviar la solicitud de lectura.
5. Abre **Ver original**, compara cada dato y corrige los errores. Los campos extraídos que estén vacíos en la ficha se seleccionan inicialmente; los campos ya capturados no se seleccionan por defecto.
6. Marca sólo los campos que deseas aplicar. Para cambiar un valor existente distinto, marca también **Autorizo reemplazar el dato existente**. No es posible borrar información de la ficha mediante campos vacíos de la extracción.
7. Escribe un comentario de al menos diez caracteres y pulsa **Confirmar y guardar campos seleccionados**. Puedes desmarcar todos para guardar sólo la revisión del documento, o **Rechazar extracción** sin modificar la persona.

Si el archivo ya estaba cargado, usa **Leer o capturar…** y selecciona el modo. Para lectura con IA de identificaciones, se pide confirmar el proveedor antes del envío. La acción **Revisar extracción** abre la bandeja filtrada por ese documento. Las cargas realizadas directamente por API o desde otros flujos no se envían automáticamente a IA: necesitan una solicitud explícita en modo `ai`.

Si el documento está vinculado a otra persona, corrige primero su clasificación. Si no tiene persona relacionada, la revisión permite seleccionar una persona física existente del Directorio.

## Eliminar una carga incorrecta

Desde **Documentos del expediente** o el repositorio **Documentos**, los perfiles con permiso de carga pueden pulsar **Eliminar** junto al archivo. El diálogo muestra el nombre y requiere un motivo de al menos diez caracteres y escribir **ELIMINAR** antes de confirmar. No requiere una migración adicional a las que ya utiliza esta versión de la aplicación.

- Se elimina esa carga y sus extracciones asociadas, incluidas sus revisiones. Los eventos de auditoría se conservan y registran quién eliminó el archivo y por qué, sin copiar los datos de la INE ni llaves de almacenamiento.
- Los campos ya aplicados a una persona no se borran ni se revierten. Si necesitas corregirlos, hazlo desde Directorio.
- La eliminación no puede deshacerse desde la aplicación. **Invalidar** es la alternativa para conservar el archivo y su revisión pero retirarlo del checklist.
- Si existen versiones anteriores disponibles, la anterior puede volver a ser la vigente. El checklist y las alertas se vuelven a evaluar al actualizar el expediente.
- No se borran contratos generados, PDF derivados, contratos firmados, evidencias de terminación, archivos aceptados desde el portal ni archivos con revisiones jurídicas o vínculos a firma. Las evidencias de tareas requieren retirar primero el vínculo. Los expedientes cerrados o cancelados conservan sus archivos.
- Se espera a que termine una extracción marcada en proceso antes de permitir el borrado. Si cambian las referencias durante la operación, el servidor rechaza la eliminación.
- El registro del documento y la auditoría se modifican en una transacción. Una copia temporal en memoria permite recuperar el archivo si falla el borrado o la confirmación de la transacción. Si tampoco es posible recuperarlo, la aplicación avisa que se necesita intervención administrativa.

La eliminación actúa sobre el almacenamiento y los datos de esta aplicación: no purga respaldos previos, versiones retenidas por el almacenamiento externo ni datos que un proveedor de IA conserve conforme a sus políticas.

## Adjuntos desde el chat de IA

Selecciona primero **Sin IA · local** o **Con IA**. El modo local muestra texto para revisión y copia, sin consultar al asistente; para guardar el original sin IA utiliza Documentos del expediente. Los pasos de clasificación y confirmación siguientes corresponden al modo con IA.

1. En el asistente flotante o en `/asistente`, pulsa **Adjuntar documentos** (`＋`), arrastra archivos al cuadro de mensaje o pega una imagen. Se admiten hasta tres PDF, JPG o PNG por mensaje, de hasta 20 MB cada uno.
2. Puedes enviar sólo los archivos o acompañarlos de instrucciones, por ejemplo: «Agrega esta INE como identificación del arrendatario en el expediente X».
3. Antes de guardar, el chat muestra el tipo detectado y una tabla preliminar de los campos visibles. Reconoce INE/IFE y comprobantes de domicilio; no valida autenticidad ni rellena datos ausentes. El titular de un recibo no necesariamente es la persona del expediente.
4. Si el expediente, la persona o su papel no están claros, el asistente debe pedir aclaración. Revisa la tarjeta de confirmación y confirma para guardar el original y su lectura pendiente en el expediente. Cancelar no guarda el documento.
5. El guardado no modifica la ficha personal. Si solicitas aplicar datos al Directorio, se prepara otra escritura que requiere su propia confirmación; revisa especialmente cualquier reemplazo de información existente. Para una INE también puedes revisar y aplicar campos desde Extracciones.

Se requiere `DOCUMENT_WRITE`. Sólo el modo con IA requiere `DOCUMENT_EXTRACTION_ENABLED=true` y el proveedor habilitado con soporte de visión y salida estructurada. El endpoint es `POST /api/assistant/attachments?extractionMode=local|ai`; omitir el modo elige lectura local. Los resultados locales se muestran sin enviar automáticamente el mensaje al asistente ni incorporar el texto local a su contexto. Los adjuntos con IA conservan los IDs asociados a tu usuario, membresía y organización.

Los archivos sin confirmar se mantienen en memoria privada del proceso por un máximo de 20 minutos (limpieza cada minuto), con límites de seis adjuntos / 40 MB por usuario y 100 MB totales. No se crean documentos, auditorías de carga ni actualizaciones personales durante la lectura preliminar. Iniciar una nueva conversación solicita descartar los adjuntos pendientes; limpiar la ventana conserva su contexto. Los archivos no sobreviven a reinicios ni se comparten entre réplicas: en despliegues con varias instancias se requiere afinidad de sesión. El navegador conserva la vista preliminar en `sessionStorage`, igual que el resto del chat, pero no el binario. Revisa el aviso de privacidad y la retención del proveedor antes de usar identificaciones reales.

Si falla el proveedor antes de obtener la lectura, el chat conserva los archivos seleccionados para volver a intentarlo. Si ya se guardó el documento pero falla el registro de su extracción, el asistente informa del guardado parcial: solicita la extracción desde el expediente y no vuelvas a cargar el original.

## Privacidad y controles

- El archivo se lee desde su llave de almacenamiento privada. La API lo envía en base64 al proveedor configurado; no publica un enlace al archivo ni expone la credencial en el navegador.
- La solicitud usa `store: false`, no habilita herramientas y trata el texto del documento como contenido no confiable. Las políticas de tratamiento y retención del proveedor deben revisarse antes de enviar documentos reales; esa opción no sustituye el aviso de privacidad ni una autorización.
- La lectura sólo produce candidatos pendientes. No se inventa un porcentaje de confianza y el revisor siempre puede corregirlos o rechazarlos.
- Sólo campos personales permitidos pueden aplicarse, con permiso `DIRECTORY_WRITE`, a una persona física de la misma organización. El documento vinculado no puede usarse para actualizar arbitrariamente otra ficha.
- Se verifican valores anteriores y modificaciones simultáneas. Si cambia la ficha, la clasificación, la versión, el estado de extracción o la invalidación del documento durante la revisión, se produce conflicto y se requiere recargar; no se impone silenciosamente una versión anterior.
- Cambios a la persona, datos confirmados del documento y revisión se guardan en una transacción. La revisión es inmutable. La auditoría de la actualización identifica campos, persona, documento y ejecución, sin copiar los valores de la INE.

## Fallos y recuperación

- **Proveedor sin visión o esquema estructurado, error, archivo ilegible o que no sea INE/IFE:** la lectura queda fallida, el archivo permanece guardado y la ficha no cambia. Puedes reintentar o capturar los campos manualmente desde Extracciones.
- **Formato incompatible:** convierte una copia a JPG, PNG o PDF y cárgala; el original permanece como evidencia.
- **Más de dos lecturas simultáneas:** las solicitudes adicionales reciben un mensaje para reintentar, sin perder el archivo. La carga por lotes solicita lecturas de forma secuencial.
- **Documento invalidado:** restáuralo antes de solicitar o confirmar extracción.
- **Columna CURP inexistente:** aplica `npm run db:deploy` antes de usar esta versión; no es un fallo de reconocimiento de la imagen.

Las pruebas automatizadas usan streams y proveedores simulados, no documentos de personas reales ni llamadas al proveedor externo. Una prueba real de extremo a extremo y la revisión visual de la pantalla son verificaciones separadas antes de presentar la funcionalidad como habilitada en un entorno.
