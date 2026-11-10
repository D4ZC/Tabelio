# Análisis local y con IA

El expediente incorpora cuatro análisis con selector **Sin IA · reglas locales / Con IA**. El modo predeterminado es local y cada análisis requiere pulsar su botón. Seleccionar IA no ejecuta una petición. Los resultados son informativos y no modifican documentos, personas, estados ni el semáforo del expediente.

## Funciones y ubicación

| Función | Dónde se utiliza | Sin IA | Con IA |
| --- | --- | --- | --- |
| Resumen del expediente | Expediente → Resumen → Análisis del expediente | Presenta estado, responsable, partes, inmueble, condiciones, requisitos, tareas y documentos registrados. | Redacta una síntesis a partir de las fuentes acotadas del mismo expediente. |
| Inconsistencias | Expediente → Resumen → Análisis del expediente | Muestra advertencias del sistema y compara nombre, CURP y código postal confirmados del documento con la persona asociada. | Explica diferencias y puntos por revisar con citas a las fuentes proporcionadas. |
| Clasificación documental | Expediente → Documentos → Clasificación sugerida | Reconoce señales de INE/IFE o comprobante de domicilio; propone Otro si no hay evidencia suficiente. | Propone identificación, comprobante de domicilio u Otro a partir del texto disponible. |
| Comparación explicada | Comparación con la versión anterior, debajo del detalle por párrafo | Describe párrafos incorporados, eliminados o modificados. | Explica las diferencias de texto entre las versiones con referencias a los párrafos. |

La comparación requiere dos versiones de un borrador DOCX. Conserva el diff exacto existente; no compara firmas, imágenes ni diseño. La clasificación reconoce las categorías indicadas, aunque la aplicación permita guardar otros tipos de documento manualmente. No se atribuye un papel de arrendador, arrendatario u obligado solidario a partir de una identificación. Si ya existe un tipo de identificación, se conserva para revisión; de lo contrario se propone Otro y la persona selecciona el papel.

**Usar sugerencia** sólo rellena el formulario de clasificación. Se debe revisar el tipo y las asociaciones y pulsar **Guardar corrección** para aplicarlos. Una sugerencia anterior queda inhabilitada al cambiar de modo o de datos hasta repetir el análisis.

## Texto, fuentes y límites

- La clasificación reutiliza texto revisado, datos confirmados o, en último lugar, una extracción pendiente identificada como tal. Si falta texto y el original es PDF/JPG/PNG, usa el [lector local](LECTURA_LOCAL.md), con su límite de 20 MB y sus restricciones de páginas y tiempo. Sin texto legible, IA se rechaza antes de inferir.
- El resultado muestra modo, fecha, fuentes por su nombre y límites de cobertura. Las fuentes se consultan dentro de la organización del usuario. Documentos invalidados y versiones históricas se excluyen de las comprobaciones de campos operativos.
- Las comprobaciones locales usan datos registrados y campos confirmados. No verifican autenticidad documental ni emiten un dictamen jurídico. Las advertencias y el semáforo calculados por el sistema se mantienen separados de la explicación con IA.
- El resumen y la revisión de inconsistencias envían como máximo 19 fuentes de hasta 2000 caracteres. El resumen limita participantes, tareas, documentos y requisitos mostrados, conservando los totales calculados. Cualquier recorte se señala en el resultado.
- La comparación explica hasta 19 párrafos modificados, con extractos acotados. El diff exacto conserva todos los cambios. La clasificación comparte con IA hasta 6000 caracteres por fuente y utiliza el texto disponible, no el archivo original.
- El servicio común de IA valida un máximo de 20 fuentes y 40000 caracteres de evidencia. Rechaza referencias a fuentes ajenas y respuestas incompatibles; no cambia automáticamente a otro modo si falla.

## Consumo y configuración

El modo local no llama al proveedor ni genera registros o cargos de IA. El modo IA utiliza la configuración `ASSISTANT_ENABLED`, `ASSISTANT_API_KEY` y el proveedor existente del asistente. La interfaz sólo habilita esa opción cuando el servidor confirma su disponibilidad.

Cada análisis con IA registra su operación, peticiones, tokens y costo estimado mediante el mismo registro de consumo del chat. Al concluir o fallar, la interfaz solicita actualizar el panel de consumo. Una respuesta rechazada por formato o citas puede haber consumido tokens y ese consumo se conserva. Las operaciones iniciadas desde el expediente se reflejan en el consumo de la aplicación y en la última operación; sólo se atribuyen a un chat cuando la petición incluye su `conversationId` autorizado.

Los importes mantienen la tarifa de referencia y la indicación de estimación existentes. No representan la factura de IBM ni una conversión verificada a Advantage Credits. El saldo IBM sigue usando el conector y la sesión W3 ya configurados.

## API

Todos los endpoints requieren autenticación y respetan la organización y los permisos del usuario:

| Método y ruta | Permiso |
| --- | --- |
| `GET /api/insights/settings` | `MATTER_READ` |
| `POST /api/insights/matters/:id/summary` | `MATTER_READ` |
| `POST /api/insights/matters/:id/consistency` | `MATTER_READ` |
| `POST /api/insights/documents/:id/classification` | `DOCUMENT_READ` |
| `POST /api/insights/documents/:id/comparison` | `DOCUMENT_READ` |

Los POST reciben `{ "mode": "local" | "ai", "conversationId": "UUID opcional" }`. Omitir `mode` selecciona local. Devuelven `kind`, `mode`, `generatedAt`, `title`, `summary`, `items`, `sources`, `limitations` y, cuando corresponde, `facts` o `suggestion`. La auditoría registra tipo, modo y cantidad de fuentes, sin copiar el contenido analizado. Las herramientas MCP indican utilizar local por defecto e IA sólo ante una solicitud expresa.

## Verificación reproducible

```sh
npm run lint
npm test
npm run build -w @despacho/api
node scripts/verify-insights.mjs
```

La integración utiliza una base con schema temporal, documentos sintéticos y un proveedor simulado de loopback. Verifica los cuatro análisis locales sin peticiones ni registro de IA, cuatro análisis IA con tokens y costo, permisos, aislamiento por organización, rechazo de modos y citas inválidas, conservación del consumo tras errores y ausencia de cambios en datos de negocio. Elimina el schema al terminar y escribe evidencia sin contenido documental ni secretos en `artifacts/insights-integration-check.json`.
