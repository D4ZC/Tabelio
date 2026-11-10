# Tabelio IA

Tabelio IA aparece en la esquina inferior derecha de todas las rutas autenticadas. Mantiene la conversación durante la sesión de la pestaña, recibe la ruta actual como contexto y puede pedir que la interfaz abra una sección o un expediente.

La franja superior muestra presupuesto, consumo personal y costo por conversación/operación. Su configuración y los estados pendientes se explican en [PRESUPUESTO_IA.md](PRESUPUESTO_IA.md).

El navegador envía el chat a `POST /api/assistant/chat`. La API usa un cliente MCP local con el mismo JWT HttpOnly de la persona conectada, enumera sólo las herramientas permitidas por su rol y vuelve a pasar cada llamada por los guards, el aislamiento por organización, los DTO y la auditoría existentes. Las consultas se ejecutan directamente. Toda operación de escritura queda pendiente hasta que la persona la confirma en el chat mediante `POST /api/assistant/actions/:id`.

Al confirmar la generación de un contrato, convenio o PDF, la respuesta incluye metadatos de descarga obtenidos del resultado real. El chat muestra un botón autenticado aunque el modelo omita el enlace o falle su resumen. Para un archivo existente, `GET /api/documents/:id/download-link` comprueba la organización y devuelve sólo su identificador, nombre y ruta de descarga; no genera otra versión ni guarda archivos en el servidor. El botón descarga mediante la sesión y el origen API configurados. La continuación después de una escritura recibe contexto interno que acredita que la persona pulsó Confirmar, para describir correctamente la autorización.

## Configuración

```dotenv
ASSISTANT_ENABLED=true
ASSISTANT_API_BASE_URL=https://api.servicesessentials.ibm.com
ASSISTANT_RESPONSES_PATH=
ASSISTANT_API_KEY=REEMPLAZAR_EN_EL_GESTOR_DE_SECRETOS
ASSISTANT_API_KEY_HEADER=Authorization
ASSISTANT_API_KEY_SCHEME=Bearer
ASSISTANT_MODEL=global-models
ASSISTANT_MCP_URL=http://127.0.0.1:4000/mcp
ASSISTANT_MCP_TIMEOUT_MS=15000
ASSISTANT_TURN_TIMEOUT_MS=90000
ASSISTANT_TIMEOUT_MS=45000
ASSISTANT_MAX_OUTPUT_TOKENS=6000
ASSISTANT_MAX_TOOL_ROUNDS=6
ASSISTANT_MAX_TOOL_CALLS_PER_RESPONSE=8
ASSISTANT_MAX_TOOL_CALLS_PER_TURN=16
ASSISTANT_MAX_PENDING_ACTIONS_PER_USER=3
ASSISTANT_RATE_LIMIT_PER_MINUTE=12
```

`ASSISTANT_API_KEY` es exclusivamente del backend. No debe guardarse en una variable `NEXT_PUBLIC_*`, enviarse al navegador, registrarse en logs ni incorporarse a una imagen de contenedor. No se reutilizan credenciales genéricas de OpenAI como respaldo, porque la URL configurada puede pertenecer a un tercero. Una clave pegada anteriormente en un chat, ticket o log debe rotarse antes de usarla.

La activación siempre es explícita: si `ASSISTANT_ENABLED` falta, el asistente permanece deshabilitado. El ejemplo local `.env.example` mantiene `ASSISTANT_ENABLED=false` para que el contenedor de desarrollo pueda iniciar sin un secreto. Después de instalar una clave nueva, confirmar el modelo y realizar la prueba mínima del proveedor, cambia el valor a `true`. El ejemplo de piloto lo deja habilitado y `pilot-deploy.sh` rechaza cualquier valor `CHANGE_ME` antes de desplegar.

El proveedor debe implementar Responses API con llamadas de función y `reasoning.encrypted_content`. El cliente envía `store: false`, `parallel_tool_calls: false` y devuelve los elementos de razonamiento cifrado en cada ronda de herramientas. No existe un fallback a Chat Completions ni a una respuesta `choices[]`; una implementación que sólo imite ese contrato será rechazada.

Por defecto se invoca `POST /v1/responses`. Si `ASSISTANT_API_BASE_URL` ya termina en `/v1`, se añade sólo `/responses`. `ASSISTANT_RESPONSES_PATH` permite reemplazar la ruta completa cuando el proxy publica otra, sin cambiar el host. `ASSISTANT_API_KEY_HEADER` y `ASSISTANT_API_KEY_SCHEME` permiten adaptar la autenticación; los valores predeterminados producen `Authorization: Bearer <clave>`. Para un encabezado que reciba la clave sin prefijo, deja `ASSISTANT_API_KEY_SCHEME` vacío.

`ASSISTANT_MODEL=global-models` es el alias configurado para este proveedor; no demuestra por sí mismo que la credencial tenga acceso a un modelo Codex ni que el alias conserve siempre el mismo modelo. Hay que confirmar con el proveedor el identificador permitido y ejecutar una solicitud mínima antes de habilitar usuarios reales. La verificación `ready` de la API comprueba base de datos y almacenamiento, pero no llama al proveedor de IA.

`ASSISTANT_TURN_TIMEOUT_MS` es el presupuesto total de una petición de chat o de una confirmación, incluidas sus llamadas al proveedor y al MCP. Dentro de ese presupuesto, `ASSISTANT_MCP_TIMEOUT_MS` limita cada conexión o llamada MCP local y `ASSISTANT_TIMEOUT_MS` limita cada solicitud individual al proveedor. El asistente permite hasta `ASSISTANT_MAX_TOOL_ROUNDS` rondas con herramientas, seis por defecto, sin superar `ASSISTANT_MAX_TOOL_CALLS_PER_RESPONSE` por respuesta ni `ASSISTANT_MAX_TOOL_CALLS_PER_TURN` durante todo el turno. Si agota las rondas, solicita una respuesta adicional para resumir los datos obtenidos con `tools: []` y `tool_choice: "none"`. Esta síntesis comparte el presupuesto de tiempo restante y no aumenta el límite de consultas. En Compose local todas las variables anteriores se propagan explícitamente al contenedor; el despliegue piloto las recibe mediante `.env.pilot` y `env_file`.

Las consultas exitosas con la misma herramienta y argumentos equivalentes se reutilizan durante el turno y su continuación; el orden de las propiedades JSON no produce una consulta distinta. Los errores no se guardan en esa caché. Una escritura confirmada y exitosa invalida las lecturas anteriores de su historial y las continuaciones guardadas de ese usuario y organización, para que no se retomen consultas anteriores al cambio. Si pasan dos rondas consecutivas sin obtener datos nuevos, descubrir otra herramienta o realizar una navegación nueva, el asistente termina las consultas y pasa a la síntesis. Cuando se solicitan detalles de «los primeros expedientes» sin indicar una cantidad, consulta inicialmente tres y aclara el orden utilizado.

Cuando una solicitud necesita continuar, la API puede devolver `continuationId` junto con `continuationSuggested`. El navegador reenvía ese identificador en `POST /api/assistant/chat` al usar «Continuar desde aquí» para recuperar los resultados de las herramientas y el catálogo seleccionado. La continuación conserva el trabajo ya realizado en vez de reconstruirlo sólo con los mensajes visibles. Si no logra generar la síntesis, el asistente también intenta conservar ese estado para continuar.

En producción, cuando `ASSISTANT_ENABLED=true`, el arranque exige una clave no vacía y sin marcadores de ejemplo, una URL de proveedor HTTPS —salvo loopback—, un modelo explícito, un MCP loopback y límites enteros positivos. Esta validación no se aplica durante build o desarrollo y se omite cuando `ASSISTANT_ENABLED=false`.

El presupuesto predeterminado es de 6,000 tokens de salida. Si el proveedor devuelve `status=incomplete` con motivo `max_output_tokens`, se descarta esa salida parcial y se reintenta una sola vez con el doble de tokens (máximo 16,000), dentro del mismo tiempo de espera. No se ejecutan llamadas parciales ni se reintentan bloqueos por contenido. Las herramientas se envían con `strict: false` para conservar como opcionales los filtros y datos no solicitados.

`GET /api/tasks/pending-summary` consulta por defecto las tareas de la persona conectada, de todas las prioridades y estados abiertos. Devuelve totales exactos y hasta ocho registros por grupo: vencidas, en plazo y sin fecha límite. Cada registro incluye expediente, responsable y vencimiento; `hasMore` indica cuándo el detalle es una selección. Admite `q` para buscar títulos o referencias y `assignee` para consultar otra asignación permitida, `all` o `unassigned`. La consulta conserva el aislamiento de la organización y requiere `TASK_READ`.

## Alcance y seguridad

- El catálogo inicial se reduce a un máximo de 24 herramientas realmente relacionadas con la conversación; no se rellena con operaciones de puntuación cero. El modelo puede buscar más capacidades durante la misma solicitud y, si alcanza el máximo activo de 32, las coincidencias nuevas reemplazan herramientas no relacionadas.
- Los resultados MCP enviados al proveedor se redactan por nombre de campo y se limitan a 20 KB.
- El chat no publica login, recuperación de contraseña ni el propio endpoint del asistente como herramientas.
- Las herramientas que aceptan `files[].path` u `outputPath` se ocultan para que el modelo remoto no controle rutas del servidor. Las cargas de otros formatos siguen en las pantallas dedicadas. El chat admite enlaces de descarga de documentos guardados mediante metadatos verificados y vuelve a exigir autenticación y permisos al descargar el archivo.
- Todo el dominio de portal se oculta al modelo embebido para impedir que invitaciones o capturas revelen tokens de acceso de un solo uso. El asistente puede guiar a la pantalla correspondiente.
- Las confirmaciones son de un solo uso, duran diez minutos y están ligadas al usuario, membresía y organización que las creó. Sólo se prepara una escritura por confirmación y cada persona puede mantener hasta `ASSISTANT_MAX_PENDING_ACTIONS_PER_USER` pendientes.
- Los identificadores de continuación son opacos, duran diez minutos y están ligados al usuario, membresía, organización y rol que los creó. Se consumen cuando la petición de continuación finaliza correctamente. El estado se guarda únicamente en memoria por instancia de API: como máximo 100 continuaciones, tres por usuario y organización, y 512,000 bytes de historial por continuación. Al alcanzar los límites de cantidad se retiran las más antiguas; un historial que supera el límite de tamaño no ofrece continuación. Un reinicio, el vencimiento o una petición atendida por otra instancia puede hacer que el identificador deje de estar disponible.
- El límite predeterminado es de doce mensajes de chat por minuto por usuario y organización, con una sola operación concurrente por persona en cada instancia de API.
- Cada petición de chat acepta hasta 24 mensajes de 8,000 caracteres. La selección inicial publica hasta 24 herramientas MCP; cada búsqueda dinámica considera hasta 16 coincidencias y puede sustituir herramientas anteriores sin superar el catálogo activo de 32.
- Cada resultado de herramienta enviado al proveedor se limita a 20 KB. La API conserva como máximo 100 confirmaciones pendientes por instancia y rechaza nuevas propuestas mientras ese límite global esté lleno.
- La respuesta del proveedor se procesa completa; esta integración no usa streaming al navegador.

## Dictado

El botón de micrófono utiliza `SpeechRecognition` o `webkitSpeechRecognition` con idioma `es-MX`. El audio no se carga a la API de Tabelio. Según el navegador, el reconocimiento puede procesarse mediante un servicio remoto del fabricante, por lo que su política de privacidad también debe revisarse. El dictado requiere una acción directa de la persona, permiso de micrófono y HTTPS fuera de localhost. Si el navegador no ofrece esa API, el botón queda deshabilitado y el chat conserva la entrada por teclado.

Los mensajes y los resultados estrictamente necesarios de las herramientas se envían al proveedor configurado, por lo que pueden incluir información legal o datos personales. Antes de producción deben revisarse el contrato de tratamiento, la retención, la residencia de datos y los controles del proveedor. `store: false` expresa que la respuesta no debe persistirse en una implementación compatible, pero no sustituye esas obligaciones contractuales.
