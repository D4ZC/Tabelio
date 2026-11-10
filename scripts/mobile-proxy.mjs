import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certificateDir = path.join(projectDir, '.certificates');
const httpsPort = Number(process.env.LOCAL_HTTPS_PORT || 3443);
const webPort = Number(process.env.PORT || 3000);
const proxyHeaders = (request) => ({
  ...request.headers,
  'x-forwarded-host': request.headers.host,
  'x-forwarded-proto': 'https',
  'x-forwarded-for': request.socket.remoteAddress || '127.0.0.1',
});

const server = https.createServer({
  key: readFileSync(path.join(certificateDir, 'server-key.pem')),
  cert: readFileSync(path.join(certificateDir, 'server.pem')),
}, (request, response) => {
  if (request.url === '/_local-https/health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ service: 'despacho-local-https', httpsPort, webPort }));
    return;
  }
  const upstream = http.request({
    hostname: '127.0.0.1', port: webPort, method: request.method,
    path: request.url, headers: proxyHeaders(request),
  }, (result) => {
    response.writeHead(result.statusCode || 502, result.headers);
    result.pipe(response);
    result.on('error', () => response.destroy());
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('La aplicación local no está disponible. Inicia el servidor web en el puerto 3000.');
  });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
});

// Next HMR uses WebSocket; the proxy keeps upgrades and binary data streaming.
server.on('upgrade', (request, socket, head) => {
  const upstream = http.request({
    hostname: '127.0.0.1', port: webPort, path: request.url,
    headers: proxyHeaders(request),
  });
  upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
    for (let index = 0; index < response.rawHeaders.length; index += 2) socket.write(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`);
    socket.write('\r\n');
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket).pipe(socket);
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => socket.destroy());
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
});
server.on('error', (error) => { console.error(`No se pudo iniciar HTTPS local: ${error.message}`); process.exitCode = 1; });
server.listen(httpsPort, '0.0.0.0', () => {
  console.info(`HTTPS móvil disponible en el puerto ${httpsPort}; conserva http://localhost:${webPort} para el conector IBM de escritorio.`);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
