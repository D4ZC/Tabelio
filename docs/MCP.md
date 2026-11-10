# MCP local de Tabelio

El servidor MCP permite que un agente propio opere la aplicación con las mismas reglas que la interfaz web. Publica una herramienta por cada operación funcional de la API: directorio, expedientes, documentos, cláusulas, portal, tareas, avisos, reportes, auditoría, piloto y lanzamiento.

El catálogo actual contiene 134 herramientas para un administrador, incluidos el resumen de tareas pendientes, los enlaces autenticados de descarga documental, la configuración pública de extracción documental, la eliminación confirmada de archivos cargados y los análisis de expediente/documentos. Se genera desde los controladores NestJS, por lo que conserva rutas, DTO, permisos y anotaciones de seguridad. Cada rol sólo recibe en `tools/list` las operaciones que puede ejecutar. Aunque una herramienta ya aparezca en la lista, la API vuelve a validar el JWT, la membresía, el rol y la organización en cada llamada.

No se publican como herramientas el inicio/cierre de sesión, recuperación o cambio de contraseña, ni los endpoints de salud. Esos flujos siguen siendo la frontera de autenticación de la aplicación. Sí se publica `despacho_auth_me` para que el agente compruebe la identidad activa.

## Endpoint y autenticación

Con la API local iniciada, el endpoint es:

```text
http://127.0.0.1:4000/mcp
```

Usa Streamable HTTP y exige en cada petición:

```http
Authorization: Bearer <JWT individual>
```

El usuario obtiene el JWT con el login normal:

```bash
curl http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"USUARIO","password":"CONTRASEÑA","organizationSlug":"ORGANIZACION_OPCIONAL"}'
```

La respuesta contiene `accessToken`. El agente debe guardarlo sólo en memoria o en el gestor seguro que ya utilice; no debe incluirlo en prompts, registros ni resultados de herramientas. El token dura ocho horas y deja de funcionar inmediatamente si cambia la contraseña, se desactiva el usuario o se retira su membresía.

## Conexión desde el agente local

El proceso del agente debe actuar como cliente MCP local. Un ejemplo mínimo con el SDK oficial:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'mi-agente-gpt', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(
  new URL('http://127.0.0.1:4000/mcp'),
  { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } },
);

await client.connect(transport);
const { tools } = await client.listTools();
const result = await client.callTool({
  name: 'despacho_search_search',
  arguments: { query: { q: 'arrendamiento' } },
});
```

Si el agente usa GPT mediante la API de OpenAI, el proceso local debe traducir `tools/list` a las herramientas que entrega al modelo y ejecutar `tools/call` cuando el modelo lo solicite. Un endpoint `localhost` no es alcanzable desde la infraestructura remota de OpenAI, así que no debe configurarse como un servidor MCP remoto de la Responses API. La conexión local debe vivir en el proceso del agente.

## Comprobación rápida

Después de obtener un JWT:

```bash
read -rsp 'JWT de Tabelio: ' DESPACHO_ACCESS_TOKEN
export DESPACHO_ACCESS_TOKEN
npm run mcp:check
unset DESPACHO_ACCESS_TOKEN
```

La comprobación abre una sesión MCP, enumera las herramientas visibles para ese usuario, consulta su perfil y termina la sesión sin modificar datos.

## Archivos

Las herramientas de carga aceptan `files`, con `path`, `field` y `mimeType` opcionales. `field` se deduce como `file` o `files`. Las descargas aceptan `outputPath`; si se omite, se guardan en `tmp/mcp-downloads`. Por seguridad, el servidor no sobrescribe archivos existentes y respeta los límites configurados de carga y descarga.

## Análisis local y con IA

`despacho_insights_summary`, `despacho_insights_consistency`, `despacho_insights_compare` y `despacho_insights_classify` reciben `body.mode`. Se utiliza `local` por defecto y `ai` sólo cuando el usuario pide expresamente un análisis con IA. Las herramientas devuelven fuentes y límites, sin aplicar cambios. Las llamadas con IA generan consumo registrado; una clasificación sugerida requiere revisión y guardado independiente. Consulta el [alcance y los límites](ANALISIS_LOCAL_IA.md).

## Configuración

- `MCP_ENABLED`: activa el endpoint. En el ejemplo de piloto queda desactivado.
- `MCP_LOCAL_ONLY`: acepta sólo conexiones loopback. Es `true` al ejecutar la API directamente.
- `MCP_INTERNAL_API_URL`: URL usada por el MCP para pasar cada operación por la API existente.
- `MCP_SESSION_TTL_MS`: vigencia máxima de inactividad de una sesión MCP.
- `MCP_MAX_SESSIONS`: máximo de sesiones locales simultáneas.
- `MCP_OUTPUT_DIR`: directorio predeterminado para descargas.
- `MCP_MAX_UPLOAD_BYTES` y `MCP_MAX_DOWNLOAD_BYTES`: límites por archivo.

La implementación sigue la [guía oficial de OpenAI para servidores MCP](https://developers.openai.com/plugins/build/mcp-server): herramientas enfocadas, esquemas explícitos, anotaciones de seguridad, autorización en el servidor y resultados útiles sin depender de una interfaz gráfica.
