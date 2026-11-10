import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certificateDir = path.join(projectDir, '.certificates');
mkdirSync(certificateDir, { recursive: true, mode: 0o700 });
const rootKey = path.join(certificateDir, 'rootCA-key.pem');
const rootCertificate = path.join(certificateDir, 'rootCA.pem');
const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
const addresses = [...new Set(Object.entries(networkInterfaces())
  .filter(([name]) => !/^(utun|tun|tap|docker|br-|veth)/.test(name))
  .flatMap(([, entries]) => entries ?? [])
  .filter((entry) => !entry.internal && entry.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address))
  .map((entry) => entry.address))];

if (!existsSync(rootKey) || !existsSync(rootCertificate)) {
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365',
    '-keyout', rootKey, '-out', rootCertificate,
    '-subj', '/CN=Tabelio Local Mobile CA', '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  chmodSync(rootKey, 0o600);
}
const extensions = path.join(certificateDir, 'server.ext');
const serverKey = path.join(certificateDir, 'server-key.pem');
const serverCertificate = path.join(certificateDir, 'server.pem');
writeFileSync(extensions, [
  'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
  'extendedKeyUsage=serverAuth',
  `subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1${addresses.map((address) => `,IP:${address}`).join('')}`,
].join('\n'));
openssl('req', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-keyout', serverKey,
  '-out', path.join(certificateDir, 'server.csr'), '-subj', '/CN=Tabelio Local');
chmodSync(serverKey, 0o600);
openssl('x509', '-req', '-in', path.join(certificateDir, 'server.csr'), '-CA', rootCertificate,
  '-CAkey', rootKey, '-CAcreateserial', '-out', serverCertificate, '-days', '90', '-sha256', '-extfile', extensions);
openssl('x509', '-in', rootCertificate, '-outform', 'der', '-out', path.join(certificateDir, 'Expediente-Local-CA.cer'));
console.info(`Certificado HTTPS preparado para localhost y: ${addresses.join(', ') || '(conecta Wi-Fi y vuelve a ejecutar mobile:setup)'}`);
console.info(`Instala y confía en este certificado público en tu teléfono: ${path.join(certificateDir, 'Expediente-Local-CA.cer')}`);
console.info('En iPhone: instala el perfil y activa Ajustes > General > Información > Ajustes de confianza de certificados.');
console.info('En Android: Ajustes > Seguridad > Cifrado y credenciales > Instalar certificado > Certificado de CA (la ruta varía según el fabricante).');
console.info('Transfiere únicamente Expediente-Local-CA.cer; las llaves privadas permanecen en esta computadora.');
console.info('Después inicia: npm run dev:mobile (HTTP escritorio 3000 + HTTPS móvil 3443). Si los servidores ya están activos, ejecuta npm run mobile:serve.');
console.info('Si cambia la IP del Wi-Fi, vuelve a ejecutar npm run mobile:setup y reinicia el proxy HTTPS.');
