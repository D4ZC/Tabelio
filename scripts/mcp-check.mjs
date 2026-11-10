import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const accessToken = process.env.DESPACHO_ACCESS_TOKEN;
const endpoint = process.env.DESPACHO_MCP_URL ?? 'http://127.0.0.1:4000/mcp';

if (!accessToken) {
  console.error('Define DESPACHO_ACCESS_TOKEN con una sesión individual vigente.');
  process.exit(1);
}

const client = new Client({ name: 'despacho-mcp-check', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
});

try {
  await client.connect(transport);
  const [{ tools }, profile] = await Promise.all([
    client.listTools(),
    client.callTool({ name: 'despacho_auth_me', arguments: {} }),
  ]);
  console.log(JSON.stringify({
    endpoint,
    toolCount: tools.length,
    identity: profile.structuredContent?.result,
  }, null, 2));
  await transport.terminateSession();
} finally {
  await client.close();
}
