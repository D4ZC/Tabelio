# Lectura documental local y con IA

La lectura local es la opción predeterminada. Extrae texto de PDF directamente y usa Tesseract para JPG, PNG y páginas PDF escaneadas. No llama a IBM ni a otro proveedor de IA, no necesita API key y no genera operaciones ni cargos en el registro de IA. Un fallo local nunca activa la IA automáticamente.

## Usar en la aplicación

- **Chat:** elige «Sin IA» en la lectura de documentos, adjunta archivos y envía. Se muestran los campos preliminares que puedan reconocerse y el texto para revisar/copiar. Esta acción no consulta al asistente. Los resultados locales no se incorporan automáticamente al contexto de posteriores mensajes con IA. Para conservar el original en un expediente sin IA, utiliza **Documentos** del expediente.
- **Expediente:** selecciona guardar sin leer, lectura local o lectura con IA antes de cargar. Para archivos existentes, selecciona el modo al solicitar la extracción. Los resultados se conservan en **Extracciones**, pendientes de revisión. No se modifica una ficha personal sin confirmar sus campos.
- **Con IA:** requiere selección explícita y configuración vigente del proveedor. En el chat permite INE/IFE y comprobantes de domicilio; en el expediente mantiene la lectura de identificaciones. Esta ruta conserva el registro de consumo del proveedor.
- **Captura manual:** continúa disponible sin usar ningún motor de lectura.

Un PDF puede combinar páginas con texto y escaneadas: se decide por página. La clasificación y los campos locales son conservadores, basados en etiquetas visibles; no se infieren fechas, género ni ubicación a partir de códigos. El OCR puede equivocarse. Siempre se compara con el original antes de aplicar datos.

## Dependencias locales

macOS con Homebrew:

```sh
brew install tesseract tesseract-lang poppler
```

Debian/Ubuntu:

```sh
sudo apt-get install poppler-utils tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng
```

La imagen Docker de la API incorpora Poppler, Tesseract y los idiomas español e inglés. Las herramientas y modelos se instalan previamente; el procesamiento de documentos no descarga modelos ni transmite archivos a servicios de OCR.

Configuración opcional en `.env`:

```dotenv
LOCAL_OCR_ENABLED=true
LOCAL_OCR_LANGUAGE=spa+eng
LOCAL_OCR_TIMEOUT_MS=90000
LOCAL_OCR_MAX_PAGES=20
LOCAL_OCR_TESSERACT_BIN=tesseract
LOCAL_OCR_PDFINFO_BIN=pdfinfo
LOCAL_OCR_PDFTOTEXT_BIN=pdftotext
LOCAL_OCR_PDFTOPPM_BIN=pdftoppm
```

`DOCUMENT_EXTRACTION_ENABLED` controla la lectura con IA; la lectura local es independiente. El estado `enabled` de configuración no sustituye una prueba de disponibilidad de los ejecutables. Si faltan herramientas o idiomas, la aplicación informa el error y permite captura manual.

## Límites y datos

- PDF, JPG y PNG, hasta 20 MB por archivo; el chat conserva su límite de tres archivos por envío.
- Hasta 20 páginas PDF, dos lecturas locales simultáneas y 90 segundos por lectura. Se limita la resolución de trabajo a 2400 píxeles y la salida de texto; los resultados truncados se indican.
- Temporales privados por lectura, eliminados al finalizar o fallar; sin comandos de shell ni URLs externas para abrir el documento.
- El texto es contenido no confiable, no una instrucción. Los campos requieren revisión humana y conservan procedencia local. No se verifica autenticidad ni validez del documento.
- Los originales y resultados confirmados del expediente conservan la política de almacenamiento existente. Los adjuntos temporales del chat conservan sus límites y vencimiento; el navegador puede conservar la vista local en la sesión del chat.

## API y verificación

`POST /api/documents/:id/extraction` recibe `{ "mode": "local" | "ai" | "manual" }`; omitir el modo selecciona `local`.

`POST /api/assistant/attachments?extractionMode=local|ai` recibe los archivos multipart; omitir el modo selecciona `local`. `conversationId` sigue siendo opcional y debe pertenecer al usuario. El resultado local incluye `text`, `extractionMode` y `extractionMethod`. En los adjuntos, el texto local crudo se excluye del contexto y de la respuesta de la herramienta de guardado que recibe el asistente. La interfaz libera el original temporal después de mostrar la lectura local para permitir nuevos envíos.

Después de compilar la API, `node scripts/verify-local-reading.mjs` comprueba texto PDF, OCR de imagen, PDF escaneado y PDF mixto con documentos sintéticos, además de verificar que la ruta local no llama al proveedor ni registra consumo de IA. La evidencia se guarda en `artifacts/local-document-reading-check.json`.
