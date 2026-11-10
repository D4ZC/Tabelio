# Presupuesto y consumo de IA

La franja superior del asistente muestra presupuesto IBM, consumo personal registrado por la aplicación, costo del chat y última operación. El detalle muestra llamadas y tokens por operación. Funciona en el panel flotante y en `/asistente`.

Los indicadores aparecen en este orden: presupuesto, consumo de este chat, última operación y consumo personal de la aplicación. La cabecera «Presupuesto y consumo» permite ocultar toda la sección y volver a mostrarla; al plegarla también se cierran el detalle y las instrucciones de conexión. El registro y la actualización del consumo continúan mientras usas el chat.

«Última operación» muestra la operación más reciente de la persona en toda la aplicación, incluidos los análisis iniciados desde un expediente. El total y el historial de «Este chat» conservan exclusivamente su conversación. Los análisis locales no generan llamadas ni cargos de IA.

Cada petición física al proveedor se registra en PostgreSQL antes de enviarse. Se incluyen las rondas, síntesis, reintentos y lecturas de documentos. Guardar o descartar un documento ya leído no agrega ni elimina su gasto. Limpiar la ventana conserva la conversación; iniciar otra crea un contador distinto. El consumo personal de la aplicación empieza en la fecha de medición indicada; el consumo IBM puede incluir otros equipos y aplicaciones.

Los importes del registro usan `Decimal(24,12)`. El cálculo usa aritmética decimal y se cuantiza a 12 decimales al persistir; la interfaz aplica su formato de presentación sin modificar el acumulado. Un error no implica costo cero. Sin un importe verificable, la petición conserva sus tokens y queda pendiente. Los intentos abiertos tras reiniciar también aparecen pendientes; no se repiten inferencias para recuperar su costo.

El navegador consulta el resumen al abrir, recuperar foco y terminar una operación; durante el trabajo lo consulta cada dos segundos y, en reposo visible, cada minuto. Las consultas se suspenden cuando el panel o la pestaña están ocultos. La consulta del presupuesto IBM tiene su propia frecuencia y estado, separados de los costos locales.

## Contrato IBM verificado

El presupuesto se consulta mediante `GET https://servicesessentials.ibm.com/services/integrations/team/{teamId}/budget`, con `Accept: application/json`, desde una sesión W3 autenticada. La API key de inferencia no autentica este endpoint: las consultas con esa clave respondieron `401`. La lectura autenticada en la página Usage permitió verificar la respuesta JSON y la unidad **Advantage Credits**.

Aunque la ruta contiene un equipo, la respuesta incluye tanto presupuesto personal como presupuesto de ese equipo:

| Campo IBM | Significado y alcance |
| --- | --- |
| `userAdvantageCredits` | Consumo individual acumulado en todos los equipos del usuario IBM. |
| `userMaxAdvantageCredits` | Límite individual global; `null` indica que no hay límite configurado. |
| `advantageCredits` | Consumo del equipo solicitado. |
| `maxAdvantageCredits` | Límite de ese equipo; `null` indica que no hay límite configurado. |
| `teamId`, `teamAlias` | Identificador y nombre del equipo consultado. |
| `budgetResetAtEpochSeconds` | Fecha de reinicio informada para el presupuesto del equipo. No se presenta como fecha de reinicio personal. |

La franja prioriza el presupuesto individual global y muestra el equipo por separado en el detalle. Si IBM no devuelve campos individuales válidos, muestra explícitamente el presupuesto compartido del equipo. El disponible se calcula como límite menos consumo cuando existe un límite. Los Advantage Credits se etiquetan como tales: no son USD ni MXN y no se suman ni convierten con los importes de las llamadas.

La respuesta de presupuesto no permite atribuir su variación a una petición concreta. Tampoco se ha verificado un cargo por petición ni una tarifa base del proveedor. `cost_tier` es un multiplicador y no basta para calcular un importe. La aplicación puede mostrar una estimación por tokens cuando se configure una tarifa explícita para el modelo. Sin costo directo ni una tarifa configurada que permita el cálculo, los costos del chat y las extracciones quedan sin importe, aunque el presupuesto IBM sí esté visible.

## Costos confirmados y estimaciones

Un **costo confirmado** es el importe comunicado por el proveedor mediante un campo o encabezado cuyo significado y unidad se verificaron. Una **estimación** se calcula a partir de tokens y una tarifa configurada; se muestra con esa etiqueta y se conserva separada del costo confirmado. Un **costo pendiente o no disponible** conserva las llamadas y tokens registrados cuando faltan datos suficientes. Si no se configuró ninguna tarifa, la interfaz informa «Tarifa sin configurar» para distinguir esa falta de configuración de un cargo que aún espera confirmación.

Para esta demo el usuario autorizó una estimación orientativa aun sin tarifa IBM. Se seleccionó la referencia pública de OpenAI para `gpt-6.1-sol`, identificando su fuente, versión y moneda. Una referencia OpenAI en USD **no representa el cargo de IBM y no convierte Advantage Credits a USD**. El registro y la interfaz la distinguen del presupuesto oficial W3 y de un importe confirmado de IBM. No hay precios predeterminados en el código; cada instalación configura la referencia explícitamente.

IBM documenta el seguimiento por tokens y los indicadores de costo, pero esas páginas no aportan la tarifa base necesaria para obtener el cargo por petición:

- [Seguimiento de uso y consumo de créditos](https://www.ibm.com/docs/en/ica?topic=settings-tracking-model-usage-credit-consumption).
- [Indicador de costo del modelo](https://www.ibm.com/docs/en/ica?topic=capabilities-starting-chat-session#GUID-e22b88f8-b83b-441c-877a-6528ed7cefaa__modelCostIndicator).

Los precios de activos por hora publicados para otro producto o modalidad no se aplican a las inferencias de esta API. `cost_tier` tampoco se convierte por sí solo en una tarifa por token.

## Conectar la demo local en Chrome

IBM bloquea las consultas directas desde `http://localhost:3000` mediante CORS. Iniciar sesión en otra pestaña por sí solo no elimina esa restricción. La demo usa la extensión propia Manifest V3 de `extensions/ibm-budget-connector` para consultar dentro del origen IBM y devolver únicamente los campos de presupuesto permitidos.

1. Abre la demo en **Google Chrome**, en `http://localhost:3000`, e inicia sesión en la aplicación.
2. Abre `chrome://extensions`, activa **Modo desarrollador** y pulsa **Cargar descomprimida**.
3. Selecciona la carpeta `extensions/ibm-budget-connector` de este proyecto. La aplicación no instala la extensión automáticamente.
4. Recarga la demo y, con esa pestaña activa, abre el icono **Tabelio · Presupuesto IBM** en Chrome y pulsa **Conectar esta demo**.
5. Abre [Usage de IBM Services Essentials](https://servicesessentials.ibm.com/settings/usage) en **el mismo perfil de Chrome** e inicia sesión W3 con la cuenta cuyo presupuesto quieres consultar. Conserva esa pestaña disponible para el conector. Si ya estaba abierta antes de instalar la extensión, recárgala para activar su script.
6. Regresa al chat y pulsa **Actualizar**. El detalle permite revisar el consumo individual global y el del equipo.

Para retirar el acceso, abre el conector y pulsa **Desconectar**. La autorización se limita a la demo en `http://localhost:3000`: otra dirección, incluido `http://127.0.0.1:3000`, no equivale al mismo origen autorizado.

La sesión del navegador integrado de Codex no se transfiere a Chrome, ni entre perfiles de Chrome. Si el conector pide iniciar sesión, hazlo en el perfil donde instalaste la extensión. Una sesión W3 vencida debe renovarse desde IBM.

El flujo es: contenido de la demo local → worker de la extensión → contenido de la página Usage de IBM → consulta del endpoint en ese mismo origen → respuesta filtrada a la demo. La extensión no lee cookies, no recibe la API key y no copia credenciales al backend. El único dato que persiste en `chrome.storage.local` es el booleano `demoConnected`; no persiste equipo, origen, presupuesto ni credenciales. Sólo devuelve los campos permitidos para identificar el equipo y presentar sus créditos y los del usuario.

Los permisos de la extensión son `storage`, `activeTab` y acceso al host `https://servicesessentials.ibm.com/*`; no solicita permiso `cookies`. Sus scripts de contenido se inyectan sólo en la demo `http://localhost:3000/*` y en `https://servicesessentials.ibm.com/settings/usage*`, en el frame principal. El worker vuelve a validar origen y frame antes de responder. Mantiene una caché temporal en memoria de hasta 16 equipos durante 30 segundos; **Desconectar** la vacía y bloquea también las respuestas que estuvieran en vuelo.

El presupuesto mostrado corresponde a la sesión IBM activa en ese perfil. `ICA_BUDGET_OWNER_EMAIL` autoriza a una persona de la aplicación a solicitar la conexión, pero no comprueba por sí solo que la sesión W3 pertenezca al mismo correo. Comprueba la cuenta activa en Usage. El último presupuesto conocido se conserva temporalmente en memoria de la interfaz durante un fallo y se marca desactualizado; no se confunde con un saldo recién consultado.

## Configuración del servidor

Las variables aparecen en `.env.example` y `.env.pilot.example`; Compose las propaga al backend. Las claves siguen fuera de `NEXT_PUBLIC_*`. La conexión local verificada usa W3, no una clave de consulta ni cookies copiadas al servidor.

| Variable | Uso |
| --- | --- |
| `ICA_BUDGET_TEAM_ID` | Equipo que se consultará en el endpoint verificado. No guardar aquí un identificador de ejemplo como si fuera real. |
| `ICA_BUDGET_URL` | Opcional si ya se configuró el equipo. Permite indicar la URL GET exacta; W3 admite únicamente la ruta de equipo verificada, sin query ni credenciales en la URL. |
| `ICA_BUDGET_AUTH_MODE` | `w3` para esta integración. `api_key` queda reservado a otro endpoint cuyo contrato de autenticación haya sido verificado; no sirve para el endpoint de equipo actual. |
| `ICA_BUDGET_OWNER_EMAIL` | Correo local autorizado a obtener la configuración de conexión. No se infiere de un rol ni de una clave compartida. |
| `ICA_BUDGET_SCOPE` | La configuración de la ruta de equipo usa `shared`. La interfaz distingue los campos individuales globales y los del equipo según la respuesta W3 verificada. |
| `AI_USAGE_PROVIDER_COST_HEADER` | Encabezado con el costo real de una petición, sólo después de verificar su significado. |
| `AI_USAGE_PROVIDER_COST_JSON_PATH` | Ruta JSON alternativa del costo por petición, sólo si el contrato la confirma. |
| `AI_USAGE_PROVIDER_COST_CURRENCY` | Moneda o unidad comprobada del costo directo por petición. Dejar vacía mientras no exista esa verificación. |
| `AI_USAGE_PRICING_JSON` | Tarifas explícitas por modelo exacto para estimar por tokens. Sin valor no se inventa una tarifa. Las tarifas de referencia deben identificarse como tales. |

El adaptador genérico de backend conserva `ICA_BUDGET_API_KEY`, `ICA_BUDGET_CURRENCY`, `ICA_BUDGET_CURRENCY_PATH`, `ICA_BUDGET_LIMIT_PATH`, `ICA_BUDGET_SPENT_PATH`, `ICA_BUDGET_REMAINING_PATH` e `ICA_BUDGET_CACHE_SECONDS` para un contrato futuro verificado en modo `api_key`. Esas variables no sustituyen la sesión W3. En ese modo genérico, la autenticación usa `ASSISTANT_API_KEY_HEADER` y `ASSISTANT_API_KEY_SCHEME`, y los snapshots se separan por usuario, organización y huella de configuración, con caché mínima de 30 segundos. **La conexión W3 de esta demo no usa esos snapshots de backend ni almacena allí cookies o presupuestos del navegador.**

No activar mapeos, monedas o tarifas supuestos. La API key del asistente continúa autenticando las inferencias desde el backend; su función es distinta de la sesión W3 que permite consultar el presupuesto.

## Configuración de tarifas y recálculo de pendientes

`AI_USAGE_PRICING_JSON` es un objeto JSON cuyas claves son los identificadores exactos del modelo. Cada entrada requiere los siguientes datos; no se sustituyen automáticamente aliases ni se aplica el precio de otro modelo:

| Campo | Contenido |
| --- | --- |
| `version` | Identificador de la tarifa o referencia. Permite reconocer la base usada en cada cálculo. |
| `currency` | Unidad explícita, como `USD` o `Advantage Credits`. No se hace conversión entre ellas. |
| `inputPerMillion` | Precio por millón de tokens de entrada, como cadena decimal. |
| `outputPerMillion` | Precio por millón de tokens de salida, como cadena decimal. |
| `cachedInputPerMillion` | Precio por millón de tokens de entrada reutilizados desde caché, como cadena decimal; opcional cuando no sea necesario para calcular. |
| `sourceUrl` | URL HTTPS de la fuente que respalda los valores, sin credenciales. En una referencia externa, indica ese proveedor, no una supuesta factura IBM. |
| `effectiveFrom` | Inicio de vigencia UTC, inclusivo. Obligatorio para estimar consumos históricos. |
| `effectiveTo` | Fin de vigencia UTC, exclusivo, cuando exista. |
| `longContext` | Opcional: `inputThresholdTokens` y tarifas de entrada, salida y caché para llamadas cuya entrada total supere ese umbral. Se aplican a toda esa llamada. |

Las cantidades se escriben como cadenas para conservar precisión. El cálculo es `(entrada sin caché × tarifa de entrada + entrada en caché × tarifa de caché + salida × tarifa de salida) / 1 000 000`. Los tokens de razonamiento están incluidos en los de salida del contrato Responses; no se vuelven a sumar. Si hay caché y falta su precio, o faltan datos que pueden cambiar el importe, la petición permanece pendiente. La caché desconocida sólo se admite cuando no afecta la suma, por ejemplo si sus tarifas de entrada y caché son iguales.

La tarifa se selecciona con el modelo efectivo informado por el proveedor, usando la fecha del intento. Si no hay modelo efectivo, sólo se considera la clave exacta del modelo solicitado que haya sido configurada; no hay búsqueda por parecido. Una fecha fuera de vigencia no se valora. Una cantidad positiva inferior a la precisión persistida permanece sin estimar en lugar de presentarse como consumo gratuito.

### Referencia orientativa seleccionada para la demo

La fuente consultada el **2 de noviembre de 2026** es la [ficha oficial de OpenAI de `gpt-6.1-sol`](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Para modalidad **Standard Global**, los precios de referencia por millón de tokens son:

| Entrada total de la llamada | Entrada sin caché | Entrada en caché | Salida |
| --- | --- | --- | --- |
| Hasta 272 000 tokens inclusive | 2 USD | 0.10 USD | 10 USD |
| Más de 272 000 tokens | 4 USD | 0.20 USD | 15 USD |

El segundo tramo aplica a todos los tokens de esa llamada, según la entrada total, no sólo al exceso sobre 272 000. El precio de caché equivale al 5 % del de entrada en ambos tramos. El multiplicador `cost_tier` de IBM no se añade a estos valores: no existe una equivalencia comprobada con esta referencia.

Ejemplo de `AI_USAGE_PRICING_JSON`, que debe guardarse en una sola línea en el archivo de entorno:

```json
{
  "gpt-6.1-sol": {
    "version": "openai-reference-2026-11-02",
    "currency": "USD",
    "inputPerMillion": "2",
    "cachedInputPerMillion": "0.10",
    "outputPerMillion": "10",
    "sourceUrl": "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
    "effectiveFrom": "2026-11-02T00:00:00Z",
    "longContext": {
      "inputThresholdTokens": 272000,
      "inputPerMillion": "4",
      "cachedInputPerMillion": "0.20",
      "outputPerMillion": "15"
    }
  }
}
```

`openai-reference-2026-11-02` identifica esta selección local. `effectiveFrom` delimita las operaciones que la demo permite valorar con la referencia consultada ese día; **no afirma que IBM ni OpenAI publicaran esa fecha como inicio oficial de su tarifa**. No se aplica a operaciones anteriores sin una fuente que respalde su período.

La referencia cubre entrada, lectura de caché y salida, incluido razonamiento dentro de la salida. La fuente también publica escrituras de caché a 2.50 USD por millón, pero el registro actual no dispone de un contador de escritura para calcularlas. Se excluyen esos cargos y los adicionales de Fast, procesamiento regional y herramientas alojadas. Por eso el valor visible es una aproximación por los tokens registrados y no una estimación completa de todos los posibles conceptos de facturación.

Cada estimación guarda `pricingSnapshotJson` con modelo, versión, fuente, unidad, tarifas, vigencia, tokens y versión de cálculo. Cambiar después la configuración no reescribe automáticamente los importes estimados ni los confirmados. Un costo directo válido del proveedor tiene prioridad sobre una estimación para una llamada nueva.

Los consumos históricos pendientes se pueden procesar explícitamente mediante `AiUsageService.estimatePending`, sin generar inferencias ni volver a leer documentos. Sólo considera registros del usuario y organización autorizados, con tokens suficientes, sin costo confirmado o estimado; si se indica un chat, valida primero su propietario. Exige `effectiveFrom` para comprobar que la referencia cubre la fecha histórica. Esta valoración orientativa es distinta de conciliar una factura real de IBM. Configurar una tarifa no ejecuta por sí solo el recálculo ni autoriza a aplicar precios actuales a cualquier fecha anterior.

El método admite `dryRun: true` para revisar los importes sin escribirlos, y `limit` de hasta 500 intentos por lote (100 por defecto). Devuelve `nextCursor`; se continúa con `afterId` para avanzar aunque un lote contenga modelos o datos que no se puedan valorar. El cursor también debe pertenecer al usuario, organización y, cuando se solicita, conversación autorizados. El snapshot conserva además el tramo y las tarifas que efectivamente se aplicaron.

## API y persistencia

- `POST /api/ai-usage/conversations` crea un chat para la sesión autenticada.
- `GET /api/ai-usage/summary?conversationId=…` devuelve la configuración de presupuesto permitida, agregados personales, `latestOperation` de la persona en toda la aplicación y hasta 100 operaciones recientes del chat. El total del chat incluye todas sus operaciones aunque el detalle se limite a 100.
- `POST /api/assistant/chat` acepta `conversationId`. Los clientes anteriores reciben uno creado por el servidor.
- `POST /api/assistant/attachments?conversationId=…` asocia las lecturas previas al mensaje con ese chat.
- Confirmaciones y continuaciones conservan su conversación mediante registros del servidor.

Los modelos son `AiConversation`, `AiOperation`, `AiUsageAttempt` y `AiBudgetSnapshot`. Las migraciones son `20261102000000_ai_usage_tracking` y `20261102010000_ai_usage_pricing_snapshot`. Los resúmenes de consumo se filtran siempre por usuario y organización. Los endpoints de consumo no forman parte del catálogo MCP publicado al modelo.

Las fronteras internas asistente → MCP → API transportan un contexto firmado con HMAC, ligado a usuario, organización, operación y caducidad. Se admite sólo por loopback y se vuelve a validar el propietario de la operación en PostgreSQL. Un argumento de herramienta o encabezado del navegador no permite reasignar el consumo.

No se guardan prompts, documentos, claves ni errores crudos del proveedor en el registro de costos. Las llamadas físicas se suman una sola vez: el desglose no vuelve a agregar el costo de una extracción al sumar su operación padre.

## Límites actuales

- La conexión de presupuesto mediante extensión está destinada a la demo local en Chrome. Otro origen o despliegue necesita un alcance de conexión revisado; no se amplían permisos automáticamente.
- La sesión W3 y una página Usage disponible deben pertenecer al mismo perfil de Chrome que la demo y el conector.
- Los chats anteriores a esta instrumentación no tienen costos reconstruidos.
- Sin costo por petición ni tarifa o referencia explícita suficiente, se conservan tokens y trazabilidad sin inventar un importe ni deducirlo del cambio de saldo.
- La valoración histórica por tarifa configurada produce estimaciones. La conciliación con cargos reales sigue necesitando un endpoint IBM por petición y sus identificadores verificables; no se reparte el gasto agregado de la cuenta.
- No se imponen bloqueos por presupuesto ni se modifica el presupuesto de IBM; esta función es de consulta y medición.

## Verificación de la integración

`node scripts/verify-ai-usage.mjs` prepara un schema PostgreSQL aislado y una API local con proveedor HTTP simulado. Verifica el flujo real chat → confirmación → MCP → extracción, suma decimal exacta, reutilización sin doble cargo, adjunto previo al mensaje, descarte, aislamiento entre usuarios, persistencia tras reinicio y costos pendientes. Limpia únicamente el schema, almacenamiento y procesos que creó. No llama a IBM ni usa su clave. La evidencia se guarda en `artifacts/ai-usage-integration-check.json`; los importes de ese archivo son simulados y no prueban tarifas IBM.

La verificación del JSON de presupuesto autenticado de IBM es independiente de esa prueba de costos simulados. El 2 de noviembre de 2026 el usuario instaló y conectó la extensión en Chrome y confirmó que veía su saldo. La revisión de la demo en ese navegador verificó el presupuesto individual, el del equipo y dos operaciones distintas (lectura de adjunto y mensaje), con llamadas y tokens persistidos. El usuario autorizó una estimación de referencia y se aplicó la tarifa OpenAI descrita arriba: 0.005400 USD para la extracción, 0.006276 USD para el mensaje y 0.011676 USD en el chat. Se comprobaron los importes y su etiqueta «Estimado · tarifa de referencia» en Chrome. Repetir el recálculo no modificó filas adicionales ni ejecutó IA. Estos valores no prueban un costo por petición ni una tarifa de IBM.

`npm test` ejecuta las suites de API, web, dominio y conector. `npm run test:budget-connector` verifica por separado los límites de origen, permisos, revocación, sesión y filtrado de datos con Chrome e IBM simulados. `npm run lint` comprueba los tipos. Las pruebas no realizan inferencias de pago.
