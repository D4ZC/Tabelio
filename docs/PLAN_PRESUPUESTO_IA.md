# Plan de integración de presupuesto y consumo de IA

Plan del 2 de noviembre de 2026, actualizado con su estado de implementación. La instrumentación, persistencia, API interna y franja del chat ya están implementadas. El flujo real se verificó con un proveedor simulado y PostgreSQL aislado.

El presupuesto IBM se verificó mediante sesión W3 y usa Advantage Credits. La demo local se conecta mediante una extensión propia de Chrome, que requiere instalación y aprobación en el perfil del usuario. No se ha verificado costo IBM por petición ni una tarifa base. Se añadió un motor de estimación por tarifa explícita y el usuario autorizó una referencia orientativa externa: OpenAI `gpt-6.1-sol` Standard Global, consultada el 2 de noviembre de 2026. Se conserva separada de los cargos confirmados y de Advantage Credits. La guía vigente de configuración e instalación está en [PRESUPUESTO_IA.md](PRESUPUESTO_IA.md).

El objetivo es mantener visibles, en la parte superior del chat, el presupuesto personal disponible, el consumo del período, el costo acumulado de la conversación y el costo de sus operaciones, incluida la lectura de documentos. El diseño debe distinguir los importes confirmados por IBM de las estimaciones y los consumos pendientes de confirmación.

## 1. Comportamiento propuesto

Añadir una franja fija bajo el encabezado del asistente, compartida por el panel flotante y la pantalla `/asistente`.

| Elemento | Información visible |
| --- | --- |
| Mi presupuesto | Disponible, límite y consumo del período, con moneda y fecha de renovación si IBM los informa. Si no existe un límite, mostrar «Sin límite configurado»; si no hay acceso al dato, «No disponible». |
| Este chat | Total acumulado de todas las llamadas de IA atribuibles a la conversación, incluidas extracciones realizadas desde ella. |
| Última operación | Nombre, costo y estado: por ejemplo, «Lectura de documento · 0.00… [moneda]». |
| Ver detalle | Desglose por mensaje, documento y operación, con importes confirmados, estimados o pendientes. |

Ejemplo de distribución, sin valores reales:

```text
Mi presupuesto: [disponible] / [límite] [moneda]   [período]
Este chat: [acumulado]    Última operación: [importe o calculando]
[Ver detalle]            Actualizado: [hora]
```

En pantallas pequeñas, distribuir estos datos en dos filas. Los estados deben expresarse con texto, además del color. Conservar suficiente precisión para distinguir operaciones pequeñas: redondear sólo al presentar, nunca al acumular. Un valor pequeño no debe aparentar ser cero.

Mientras una llamada siga en curso, mostrar «Calculando» y el acumulado conocido. Actualizar después de cada llamada terminada, aunque el turno completo siga trabajando. No prometer un importe monetario definitivo por token mientras el proveedor no lo reporte.

«Limpiar ventana» conserva la conversación y su costo. «Nueva conversación» inicia un contador nuevo sin borrar el gasto histórico personal. Descartar un adjunto o cancelar su guardado no elimina el costo de haberlo leído.

## 2. Hallazgos iniciales que motivaron la implementación

Estos hallazgos describen la aplicación antes de la integración. La persistencia y el seguimiento indicados como ausentes ya se añadieron. Se usa sondeo para actualizar los resúmenes durante un turno.

- `apps/web/components/ai-assistant.tsx` contiene el encabezado común, el estado del chat, el envío de adjuntos y los botones de limpieza. Conservaba mensajes en `sessionStorage`, pero no tenía un identificador de conversación persistido en servidor.
- `apps/web/components/assistant-host.tsx` ya conoce usuario y organización mediante `/auth/me`.
- `apps/api/src/assistant/assistant-provider.service.ts` centraliza las peticiones al proveedor para chat y extracción. Su contrato todavía no tipaba ni registraba `usage`, costo o modelo efectivo. Puede reintentar una respuesta incompleta y descartar el primer resultado.
- `apps/api/src/assistant/assistant.service.ts` puede realizar varias rondas y una síntesis para un mismo mensaje, además de continuar después de confirmar una acción.
- `apps/api/src/assistant/assistant-attachments.service.ts` procesa documentos al adjuntarlos, antes del envío del mensaje. Guardarlos después reutiliza esa lectura.
- `apps/api/src/documents/extraction/ai-document-extraction.service.ts` utiliza el mismo proveedor para extraer documentos desde el expediente.
- `packages/database/prisma/schema.prisma` tenía `DocumentExtractionRun`, pero no conversaciones ni registros de consumo de IA.
- La clave del proveedor se configura en el backend. Esto no demuestra que cada usuario de la aplicación tenga una identidad o presupuesto individual en IBM.
- No había un canal SSE/WebSocket para actualizar el gasto durante un turno; la entrega actual usa sondeo.

## 3. Fase 1: verificar el contrato real de IBM

Fuente solicitada: https://servicesessentials.ibm.com/services/apis/docs/ica-ai-apis-swagger-ui/index.html

El Swagger y la consulta con API key no permitieron autenticar el presupuesto. Después se verificó mediante sesión W3 el endpoint `GET /services/integrations/team/{teamId}/budget` en Services Essentials. La respuesta contiene Advantage Credits y distingue `userAdvantageCredits` / `userMaxAdvantageCredits` —consumo y límite personales globales en todos los equipos— de `advantageCredits` / `maxAdvantageCredits` —consumo y límite del equipo solicitado—. El identificador de equipo en la ruta no convierte los campos personales en presupuesto exclusivo de ese equipo.

El presupuesto individual se presenta como tal y el del equipo queda en el detalle. Un límite `null` se muestra como «Sin límite configurado». La fecha `budgetResetAtEpochSeconds` se vincula al equipo, sin atribuirla al presupuesto personal.

CORS impide consultar este endpoint directamente desde localhost. La solución elegida para la demo usa una extensión propia Manifest V3 en Chrome: contenido de la demo → worker → contenido de la página Usage de IBM → fetch en ese mismo origen → campos de presupuesto permitidos. La sesión W3 permanece en el mismo perfil de Chrome; no se leen cookies ni se usa la API key para esta consulta. Una sesión en el navegador integrado de Codex no se transfiere a Chrome. La extensión sólo admite `http://localhost:3000`, se conecta con «Conectar esta demo» y se puede retirar con «Desconectar».

La consulta autenticada permitió confirmar presupuesto y unidad, pero no un precio por petición ni una tarifa base. `cost_tier` es un multiplicador insuficiente para calcular ese precio. Siguen pendientes el detalle de facturación por petición, su correlación verificable y las tarifas IBM necesarias para estimar su cargo cuando no exista costo directo. No se usan diferencias de saldo para inventar costos de operaciones, ni se convierten Advantage Credits a USD o MXN. La referencia pública externa autorizada puede usarse para una estimación por tokens en su propia moneda, indicando que no representa el cargo IBM.

La aplicación conserva la atribución local por usuario y organización, separada del presupuesto de la sesión IBM activa. La configuración del propietario autoriza al usuario local a obtener la conexión; el usuario debe comprobar que inició sesión con la cuenta IBM correspondiente en ese Chrome.

## 4. Fase 2: persistencia y atribución implementadas

Se crearon los siguientes modelos con la migración `20261102000000_ai_usage_tracking`:

| Modelo | Responsabilidad |
| --- | --- |
| `AiConversation` | Organización, usuario y fecha de inicio del chat. No exige almacenar el texto de los mensajes. |
| `AiOperation` | Mensaje/turno, extracción o acción, relación con conversación y operación padre, documento opcional y estado. |
| `AiUsageAttempt` | Una fila por petición física al proveedor, incluidos reintentos: tokens, modelo efectivo, IDs de trazabilidad, importes, moneda, fuente y estado de confirmación. |
| `AiBudgetSnapshot` | Snapshot con límite/saldo/consumo y momento de consulta para el adaptador genérico `api_key`. La conexión W3 local no persiste aquí el presupuesto. |

Se usa `Decimal` para importes y unidad explícita. Las estimaciones usan tarifas explícitas por modelo, con versión y fuente; hoy no existe una tarifa base comprobada de IBM. La referencia externa autorizada produce una aproximación identificada como tal, sin convertir Advantage Credits. El cálculo se cuantiza a 12 decimales para persistir. Conservar por separado importe informado y estimado; un ajuste de conciliación actualiza el importe aplicable sin agregar un segundo cargo. No mezclar ni sumar unidades/monedas diferentes. No guardar claves, prompts, archivos ni datos personales del documento en el registro de costos.

Crear el identificador de conversación en el backend antes de la primera carga o llamada de IA. Reutilizarlo al recargar, cambiar entre panel y pantalla completa, confirmar acciones o continuar. Cada conversación y operación debe validar propietario y organización mediante la sesión; no confiar en identificadores de usuario aportados por el navegador.

Registrar una extracción fuera del chat en el gasto personal, sin asignarla arbitrariamente a la conversación abierta. Una extracción iniciada desde el chat sí integra su total, incluso si nunca se envía el mensaje o se elimina el adjunto.

El presupuesto oficial puede incluir gasto anterior o generado fuera de esta aplicación. Los costos locales por chat empiezan a medirse al habilitar esta función; no reconstruir chats antiguos sin registros de IBM que permitan una asociación verificable. Mostrar «Medición desde [fecha]» cuando corresponda.

## 5. Fase 3: instrumentación del proveedor y los flujos implementada

`AssistantProviderService` es el punto único de captura del consumo. Persistir un intento antes de enviar cada petición y registrar la respuesta antes de validar contenido, lanzar errores o decidir un reintento. Si no se puede crear ese registro inicial, no iniciar una llamada nueva a IBM. Los intentos que queden abiertos después de un reinicio se recuperan como pendientes de conciliación, sin reenviar automáticamente la petición.

Propagar identidad y correlación por chat, síntesis, confirmaciones, continuaciones, adjuntos y extracción desde expediente. Las herramientas MCP cruzan una frontera HTTP interna: transportar y validar la correlación mediante contexto interno autorizado; un contexto de memoria local por sí solo no es suficiente. No permitir que un encabezado del navegador ni un argumento del modelo reasigne cargos a otra persona.

Reglas de contabilización:

- Una llamada física se suma una vez. El total del chat suma sus intentos; el desglose por operación agrupa esos mismos intentos, sin volver a sumar los subtotales de padres e hijos.
- El razonamiento que prepara varias herramientas se atribuye al turno. La extracción conserva su costo directo separado; no repartir arbitrariamente tokens entre herramientas. El detalle distingue ese costo directo del costo de IA que coordinó el turno.
- Contar todas las rondas, síntesis y reintentos que efectivamente consuman IA, incluso si la respuesta final resulta inválida o la operación de negocio falla.
- Reutilizar una extracción existente, guardar un adjunto ya leído o consultar una herramienta local sin IA no genera un nuevo cargo de IA por sí mismo.
- Prioridad del importe: costo informado por el proveedor; en su ausencia, estimación con usage y tarifa explícita. Una referencia externa autorizada se identifica por fuente, versión y moneda, sin presentarse como cargo IBM. Si faltan datos suficientes, queda pendiente o no disponible. Ausencia de costo no significa costo cero.
- Un timeout puede haber consumido en IBM. Conservarlo pendiente para conciliación; no asumir gratuitamente que no hubo cargo.
- Deduplicar mediante el identificador local del intento y los IDs estables del proveedor cuando su unicidad y alcance estén verificados.
- Mantener el registro aunque se descarte un archivo, se cancele una confirmación o falle un paso posterior. Si la captura del consumo falla, conservar la trazabilidad y marcar el resumen como incompleto; no devolver un total aparentemente definitivo.

## 6. Fase 4: API interna y actualización de la interfaz

Rutas implementadas de nuestra aplicación; son independientes del endpoint de IBM:

- `POST /api/ai-usage/conversations`: iniciar conversación y obtener su ID.
- `GET /api/ai-usage/summary?conversationId=…`: configuración de presupuesto permitida, consumo personal y total/desglose del chat.
- `POST /api/assistant/chat`: recibe `conversationId`; el servidor conserva ese vínculo al confirmar o continuar.
- `POST /api/assistant/attachments?conversationId=…`: atribuye cada lectura previa al mensaje a la conversación. El ID se envía en query, sin ampliar los campos multipart de archivos.

La entrega actual usa sondeo de resúmenes persistidos: cada dos segundos durante una operación y cada minuto en reposo visible, además de apertura, foco y finalización. Se suspende cuando el panel o la pestaña están ocultos. No se añadió SSE ni infraestructura de eventos distribuida; el resumen en PostgreSQL permite recuperar el estado tras recargar o reiniciar.

La consulta W3 de presupuesto usa la extensión y su propia actualización, como máximo una vez por minuto salvo petición manual. El último saldo conocido permanece temporalmente en memoria de la interfaz y se marca desactualizado ante un fallo. El conector guarda sólo la aprobación local de conexión, sin persistir presupuestos. Los snapshots de backend pertenecen exclusivamente al adaptador genérico `api_key`, reservado para otro contrato verificado; no almacenan la sesión ni los presupuestos W3 de esta demo.

Mostrar última sincronización, estado desactualizado y errores recuperables. Conservar el último presupuesto conocido durante una caída de IBM. Separar «Saldo confirmado a [hora]» de «Consumo reciente pendiente de IBM»; no descontar otra vez importes ya incluidos en un snapshot. Una proyección de saldo sólo es admisible si se conocen qué cargos siguen pendientes.

## 7. Fase 5: validación implementada y conciliación pendiente

Las pruebas unitarias y la verificación real local cubren las atribuciones y sumas. `node scripts/verify-ai-usage.mjs` ejecuta Nest, MCP, extracción y PostgreSQL aislado con costos simulados, sin llamar a IBM; guarda evidencia en `artifacts/ai-usage-integration-check.json`.

La valoración orientativa de históricos se hace explícitamente con `estimatePending`, tarifa configurada en `AI_USAGE_PRICING_JSON` y vigencia `effectiveFrom` que cubra la fecha de cada intento. Ofrece simulación sin escritura y lotes con cursor para avanzar sobre intentos que no se puedan valorar. No genera nuevas inferencias, no alcanza consumos ajenos y no sobrescribe costos confirmados o ya estimados. Cada estimación guarda un snapshot auditable de tarifas, tramo aplicado y tokens en `pricingSnapshotJson`.

La referencia seleccionada es la [ficha oficial OpenAI de `gpt-6.1-sol`](https://developers.openai.com/api/docs/models/gpt-6.1-sol): entrada 2 USD, caché 0.10 USD y salida 10 USD por millón; con más de 272 000 tokens de entrada, 4, 0.20 y 15 USD respectivamente para toda la llamada. La versión local `openai-reference-2026-11-02` permite valorar operaciones desde `2026-11-02T00:00:00Z`; esa fecha delimita la configuración de la demo y no es una vigencia oficial de IBM. No se aplica `cost_tier` de IBM ni se convierten créditos. Las escrituras de caché y cargos de Fast, procesamiento regional y herramientas alojadas quedan fuera del cálculo por falta de sus contadores o modalidades; la interfaz debe mantener la etiqueta de estimación.

La conciliación automática con cargos reales sigue pendiente de un endpoint IBM por petición con IDs y costos verificables. Cuando exista, conciliar intentos locales con esos registros. Los cambios de estado de pendiente/estimado a confirmado no crean consumo adicional. Las diferencias agregadas sin correlación permanecen como diferencias de cuenta y no se reparten arbitrariamente entre usuarios o chats.

Extender las suites existentes del proveedor, asistente, continuaciones, adjuntos y extracción. Cubrir:

1. Un mensaje con múltiples rondas y síntesis acumula todas las peticiones.
2. Una respuesta incompleta y su reintento quedan registrados, sin perder el primer consumo.
3. Adjuntar extrae y suma antes del mensaje; guardar, reutilizar o descartar no duplica ni borra el cargo.
4. Confirmar o continuar conserva conversación y atribución; limpiar conserva el total y nueva conversación inicia otro.
5. Recargar, reconectar o reiniciar la API conserva los costos ya persistidos.
6. Usuarios y organizaciones no pueden consultar ni reasignar costos ajenos; la correlación interna no permite suplantación.
7. Timeout, respuesta inválida y datos de costo ausentes muestran estados pendientes/no disponibles correctos.
8. Conciliación tardía, concurrencia y reintentos de persistencia no duplican cargos; decimales, caché y categorías de tokens no se cuentan dos veces.
9. La interfaz mantiene legibilidad y estados claros en panel, pantalla completa y móvil, incluso con IBM inaccesible.

Ejecutar pruebas de las áreas modificadas, lint/TypeScript y build. Verificar el contrato IBM con lecturas; cualquier prueba real de inferencia que consuma presupuesto debe ser explícita y acotada durante la implementación. No hace falta consumir IA para aprobar este plan.

## 8. Estado de entrega y criterios de aceptación

- Implementado y verificado localmente: conversaciones persistidas, operaciones, intentos por llamada, aislamiento, correlación MCP firmada y sumas sin duplicados.
- Implementado: franja superior, detalle, conservación del gasto al limpiar/descartar y actualización durante turnos mediante sondeo.
- Verificado con sesión W3: contrato de presupuesto y Advantage Credits, con alcance personal global y de equipo separados.
- Conexión verificada en la demo: extensión Chrome propia para `http://localhost:3000`, instalada y conectada por el usuario. Se confirmó el saldo individual y del equipo y el registro separado de lectura y mensaje. Sus dos costos se valoraron con la referencia autorizada: 0.005400 USD para la extracción y 0.006276 USD para el mensaje; total estimado de 0.011676 USD. Las instrucciones para otros perfiles están en `PRESUPUESTO_IA.md` y en la interfaz.
- Implementado: estimación opcional por tokens con tarifa explícita, modelo exacto, vigencia y snapshot de auditoría; recálculo orientativo de pendientes por usuario/organización/chat. La referencia externa autorizada se presenta en su moneda como estimación, sin convertir el presupuesto IBM.
- Pendiente de contrato del proveedor: costo real por petición, tarifa base IBM y conciliación con facturación real. Donde falte una tarifa configurada o datos suficientes, el importe permanece sin estimar.

La función estará lista cuando el usuario pueda ver su presupuesto con alcance y período correctos; el costo de un chat persista; la lectura de cada documento aparezca por separado y dentro del chat correspondiente; los importes se actualicen después de cada llamada terminada; y las estimaciones, pendientes y errores estén identificados sin aparentar precisión inexistente.

La API key de inferencia permanece en el backend, fuera del código y de las variables públicas. La consulta W3 de presupuesto usa la sesión de Chrome mediante el conector; no copia cookies ni utiliza esa API key. La extensión almacena sólo la aprobación de conexión local y devuelve una lista limitada de campos de presupuesto.
