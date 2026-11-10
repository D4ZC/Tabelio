# Paso a paso: Tabelio en Vercel, Supabase y Railway

Para una demo de pruebas con dos usuarios. Revisado el 10 de noviembre de 2026 contra la estructura actual del proyecto. Esta guía describe acciones que debe ejecutar el usuario; no se han creado cuentas, publicado repositorios ni desplegado servicios.

La ruta usa Supabase Free, Railway Trial/Free y Vercel Hobby si el proyecto cumple sus condiciones de uso personal no comercial. El trial de Railway dura hasta 30 días o USD 5 consumidos; Free posterior tiene USD 1 de crédito mensual y 512 MB RAM. El uso de IA se cobra o descuenta por separado según el proveedor.

Se parte de una **base nueva**. Los documentos y expedientes locales no se copian automáticamente. Primero quedará disponible la aplicación con administración y documentos; después se activa IA y se verifica el recorrido completo.

## 1. Preparar cuentas y herramientas

Necesitas cuentas en GitHub, Supabase, Railway y Vercel. Para Railway, conectar GitHub puede ser necesario para que el trial no tenga restricciones de red saliente.

En Terminal de macOS, usando zsh:

```bash
cd "/Users/d4zc/Documents/Demo Despacho"
node --version
npm --version
git --version
```

Usar Node 24 para coincidir con el contenedor y npm 11 o compatible con el lockfile. No hace falta instalar LibreOffice en la computadora para ejecutar las migraciones; el contenedor ya lo incluye.

## 2. Preparar el código y subirlo a GitHub

### 2.1 Evitar subir archivos locales

Añade estas reglas al final de `.gitignore`, conservando las actuales:

```gitignore
.env*
!.env.example
!.env.pilot.example
tmp/
artifacts/
documentos-organizados/
*.tsbuildinfo
*.doc
*.docx
!apps/api/templates/*.docx
```

Conservar las dos plantillas de `apps/api/templates`: el backend las necesita. No subir las carpetas con expedientes originales, respaldos ni almacenamiento. Las exclusiones no retiran archivos que ya estuvieran versionados; revisar lo que se va a publicar.

### 2.2 Hacer que Railway construya la API

El Dockerfile actual termina en el target de web. Añade **una sola vez al final de `Dockerfile`**:

```dockerfile
FROM api AS railway
```

Así, el build predeterminado terminará en la API y heredará su comando de arranque y el puerto 4000. Los targets explícitos `web`, `api` y `migrate` siguen disponibles. El builder todavía compila el monorepo; separarlo puede hacerse después de la demo.

### 2.3 Crear el repositorio

La carpeta no tenía Git al preparar esta guía. Desde su raíz:

```bash
git init
git add .gitignore .dockerignore package.json package-lock.json tsconfig.base.json Dockerfile
git add apps packages scripts extensions
git diff --cached --stat
```

Revisa la lista y el diff antes del commit: debe contener código y plantillas, no `.env`, respaldos ni originales del despacho. Si existen cambios personales ajenos al despliegue, selecciona sólo los archivos que quieras publicar.

```bash
git diff --cached
git commit -m "Preparar demo para despliegue"
git branch -M main
```

En GitHub crea un repositorio **privado y vacío**, por ejemplo `tabelio-demo`, sin agregar README ni otro `.gitignore`. Copia su URL y reemplaza el marcador:

```bash
git remote add origin https://github.com/TU_USUARIO/tabelio-demo.git
git push -u origin main
```

Si GitHub pide autenticación, usa el inicio de sesión de GitHub CLI o el mecanismo Git que ya tengas configurado. No uses la contraseña de tu cuenta como token.

## 3. Crear Supabase Free

1. En Supabase, crea un proyecto en una organización Free. Guarda su contraseña PostgreSQL y elige una región cercana a los usuarios y al backend.
2. Busca **Data API** en la configuración y desactívala: esta aplicación utiliza Prisma desde NestJS, no acceso directo del navegador a tablas.
3. En **Connect**, copia la cadena de **Session pooler**, normalmente puerto 5432. También sirve la conexión directa si tu red tiene conectividad compatible. No usar Transaction pooler para migrar.
4. Sustituye el marcador de contraseña de la cadena. Si contiene caracteres reservados de URL, codifícalos. Utiliza TLS (`sslmode=require`) y el esquema `public`; agrega parámetros con `&` si la cadena ya incluye `?`.
5. En **Storage**, crea el bucket `expedientes-demo` con acceso **privado**.
6. En la configuración S3 de Storage, genera un **Access Key ID y Secret Access Key**. Copia también el endpoint S3 y la región exactos. Estas credenciales son distintas de las claves publishable/anon y de la contraseña PostgreSQL.

No crear los dos usuarios en Supabase Auth. Tabelio administra sus usuarios y membresías en sus propias tablas.

## 4. Aplicar migraciones y crear el administrador

Hazlo **antes de publicar la API**. La variable se captura sin mostrarla ni escribirla como literal en el historial. Los comandos de captura siguientes son para zsh:

```bash
cd "/Users/d4zc/Documents/Demo Despacho"
read -r -s "DATABASE_URL?Pega la conexión de Supabase: "
printf '\n'
export DATABASE_URL
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
```

Si falla un comando, corrige el error antes del siguiente. No ejecutar `db:push`, `migrate dev` ni reset sobre el destino.

El seed crea organización, requisitos y un administrador con credenciales conocidas. Reemplázalo inmediatamente por tu cuenta, manteniendo el slug de organización `demo-despacho`, que el login actual utiliza:

```bash
read -r "BOOTSTRAP_ADMIN_EMAIL?Correo de tu administrador: "
read -r -s "BOOTSTRAP_ADMIN_PASSWORD?Contraseña nueva (10+ caracteres, mayúscula, minúscula y número): "
printf '\n'
export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === 'admin@demo.local') {
    throw new Error('Usa tu correo válido, distinto del administrador demo.');
  }
  if (password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('La contraseña no cumple los requisitos.');
  }
  await prisma.user.update({
    where: { email: 'admin@demo.local' },
    data: {
      email,
      displayName: 'Administrador',
      passwordHash: await hash(password, 12),
      sessionVersion: { increment: 1 },
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  const remaining = await prisma.user.count({ where: { email: 'admin@demo.local' } });
  if (remaining !== 0) throw new Error('Todavía existe el administrador demo.');
  console.info('Administrador actualizado; cuenta demo retirada.');
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
NODE
unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD DATABASE_URL
```

Continúa sólo después del mensaje de éxito. Si falla la contraseña o el correo antes de actualizar, repite la captura y el bloque Node; **no repitas el seed**. Después de renombrar al administrador, volver a ejecutar `db:seed` recrearía la cuenta demo con contraseña conocida.

## 5. Publicar primero la web en Vercel

1. En Vercel, importa el repositorio privado desde **Add New → Project**.
2. Selecciona **Next.js** y **Root Directory: `apps/web`**.
3. Habilita **Include source files outside of the Root Directory in the Build Step**, si se muestra.
4. Configura **Node.js 24.x**.
5. En los overrides, usa **Install Command:** `cd ../.. && npm ci` y **Build Command:** `npm run build`. Deja **Output Directory** en la configuración automática de Next.js.
6. Agrega para Production: `NEXT_PUBLIC_API_URL=/api`.
7. Despliega y abre la pantalla de login. Todavía no debe poder iniciar sesión porque falta el backend.
8. Copia la URL **estable del proyecto**, por ejemplo `https://tabelio-demo.vercel.app`, no una URL que cambia por commit.

La etiqueta `Production` de Vercel identifica la rama/URL estable; no obliga a contratar Pro ni cambia el carácter de pruebas de esta demo. La elegibilidad para Hobby depende de sus condiciones de uso.

No agregues credenciales de base, S3 o IA a Vercel.

## 6. Crear la API en Railway

1. Crea un proyecto desde **Deploy from GitHub repo** y selecciona el repositorio.
2. Usa la **raíz del repositorio** como Root Directory. Railway debe detectar `Dockerfile`.
3. Conserva el arranque del Dockerfile; deja **Start Command** sin override. No usar `npm start` ni ejecutar migraciones en cada arranque.
4. Si hay un primer intento antes de configurar variables, puede fallar; completa las variables y vuelve a desplegar.
5. Configura una sola réplica, sin contratar ampliaciones de recursos.

En **Variables**, agrega los siguientes valores. Reemplaza los marcadores con datos reales, sin copiar los caracteres `<` y `>`:

```dotenv
NODE_ENV=production
API_PORT=4000
WEB_ORIGIN=https://TU_PROYECTO.vercel.app
DATABASE_URL=<conexión PostgreSQL de Supabase en modo sesión>
JWT_SECRET=<secreto aleatorio propio>
COOKIE_SECURE=true
PASSWORD_RECOVERY_DRIVER=disabled

STORAGE_DRIVER=s3
S3_ENDPOINT=<endpoint S3 exacto del panel Supabase>
S3_REGION=<región S3 del panel>
S3_ACCESS_KEY=<Access Key ID de S3>
S3_SECRET_KEY=<Secret Access Key de S3>
S3_BUCKET=expedientes-demo
S3_FORCE_PATH_STYLE=true

TEMPLATE_ROOT=/app/apps/api/templates
LIBREOFFICE_BIN=soffice
PDF_CONVERSION_TIMEOUT_MS=60000
LOCAL_OCR_ENABLED=true
LOCAL_OCR_LANGUAGE=spa+eng
LOCAL_OCR_MAX_PAGES=3
LOCAL_OCR_TIMEOUT_MS=90000

MCP_ENABLED=true
MCP_LOCAL_ONLY=true
MCP_INTERNAL_API_URL=http://127.0.0.1:4000/api
ASSISTANT_MCP_URL=http://127.0.0.1:4000/mcp
ASSISTANT_ENABLED=false
DOCUMENT_EXTRACTION_ENABLED=false
```

Para generar `JWT_SECRET` en tu computadora, ejecuta `openssl rand -hex 32` y copia el resultado sólo a Railway. Aunque sea una demo, NestJS debe ejecutarse con `NODE_ENV=production` y cookies seguras sobre HTTPS.

`LOCAL_OCR_MAX_PAGES=3` limita esta primera prueba a documentos de hasta tres páginas; rechaza PDFs mayores. Puedes aumentarlo hasta el límite del código después de medir memoria. Las variables de IA en `false` sólo corresponden a la verificación inicial; se activan en el paso 10.

En **Settings → Networking**, genera el dominio público y configura **Target Port: 4000**. En el apartado de despliegue agrega **Healthcheck Path: `/api/health/ready`**. Despliega de nuevo si las variables/configuración estaban pendientes.

Abre:

```text
https://TU_SERVICIO.up.railway.app/api/health/ready
```

Debe responder con estado `ready` y comprobaciones de base y almacenamiento correctas. Copia el dominio de Railway. Si falla, revisa logs antes de conectar la web.

## 7. Conectar Vercel con Railway

En las variables del proyecto Vercel para Production:

```dotenv
NEXT_PUBLIC_API_URL=/api
API_PROXY_TARGET=https://TU_SERVICIO.up.railway.app/api
```

Haz **Redeploy** del deployment de la rama principal. Es necesario porque los rewrites se construyen al generar la web.

Mantener `/api` es intencional: el navegador habla con el mismo origen Vercel y conserva la cookie. No pongas la URL de Railway en `NEXT_PUBLIC_API_URL` para esta ruta con dominios gratuitos.

Abre ahora:

```text
https://TU_PROYECTO.vercel.app/api/health/ready
```

Si responde `ready`, el proxy web ya alcanza la API. Si configuraste protección de acceso de Vercel, inicia sesión en esa protección o concede acceso a los participantes antes de probar el endpoint.

## 8. Entrar y crear al segundo usuario

1. Abre la URL estable de Vercel y entra con **el correo y la contraseña del administrador que acabas de configurar**. El formulario actual muestra credenciales locales prellenadas: reemplázalas.
2. Ve a **Equipo → Nuevo integrante** y crea la segunda cuenta con rol Operación o Jurídico, según lo que necesite probar.
3. Entrega la contraseña temporal por el canal acordado y pide al segundo usuario cambiarla en **Mi cuenta**. La app no obliga a cambiarla automáticamente en el primer acceso.
4. Abre otra ventana de navegador o el teléfono e inicia sesión con esa segunda cuenta.

La recuperación automática por correo sigue deshabilitada. Ambos usuarios pertenecen a la organización `demo-despacho` creada antes.

## 9. Verificar la aplicación desplegada

Desde la URL de Vercel, probar:

- Login, recarga de página, logout y nuevo login.
- Crear una persona, un inmueble y un expediente de prueba.
- Subir un PDF/JPG pequeño y descargarlo; comprobar que persiste tras un redeploy.
- Completar los requisitos necesarios para generar un contrato DOCX y su PDF.
- Ejecutar OCR con una muestra corta y comprobar el resultado.
- Repetir operaciones con el segundo usuario y desde el móvil usando el enlace público directamente.

Después, probar tamaños de archivo y lotes que realmente se usarán. No dar por soportado el máximo de 20 MiB por archivo o diez archivos simultáneos hasta comprobar proxy, tiempos y RAM. En Railway observar memoria, reinicios y crédito disponible.

El botón de QR móvil y el conector IBM del navegador todavía dependen de la configuración local; el acceso al teléfono mediante la URL pública funciona sin ese QR. Si estos dos elementos forman parte de la demo, requieren adaptar el dominio/QR y desplegar esos cambios antes de aceptarlos como listos.

## 10. Activar el asistente y la extracción con IA

Una vez que las operaciones anteriores funcionen, configura **sólo en Railway** los valores reales que ya utilices con tu proveedor:

```dotenv
ASSISTANT_ENABLED=true
ASSISTANT_API_BASE_URL=<base HTTPS verificada del proveedor>
ASSISTANT_RESPONSES_PATH=<ruta completa del endpoint Responses si se necesita; si no, vacío>
ASSISTANT_API_KEY=<clave privada real>
ASSISTANT_API_KEY_HEADER=Authorization
ASSISTANT_API_KEY_SCHEME=Bearer
ASSISTANT_MODEL=<modelo habilitado en tu proveedor>
ASSISTANT_MCP_URL=http://127.0.0.1:4000/mcp
ASSISTANT_MCP_TIMEOUT_MS=15000
ASSISTANT_TURN_TIMEOUT_MS=90000
ASSISTANT_TIMEOUT_MS=45000
ASSISTANT_MAX_OUTPUT_TOKENS=6000
DOCUMENT_EXTRACTION_ENABLED=true
```

Los valores de header y esquema deben coincidir con el proveedor; `Authorization`/`Bearer` son los del ejemplo actual. Si se configura `ASSISTANT_RESPONSES_PATH`, sustituye el pathname de la base; no se concatena como sufijo. Copia una clave real, no una referencia `${OTRA_VARIABLE}` sin configurar. El modelo debe existir en tu cuenta; esta guía no crea acceso ni crédito de IA.

Redeploy de Railway y prueba chat, una consulta del expediente, una acción con confirmación y lectura IA de una identificación de prueba. El MCP debe seguir por loopback; no necesitas exponer `/mcp` al navegador.

## 11. Cierre de la prueba y próximos despliegues

La demo queda validada cuando ambos usuarios completan el recorrido que van a presentar. Antes de cada sesión revisa que Supabase no esté pausado y que Railway tenga crédito; despierta el servicio y haz una prueba de login/PDF antes de la reunión.

Para futuras modificaciones de código: commit, push y revisión de deployments en ambos proveedores. Si agregas migraciones, ejecútalas una vez con `npm run db:deploy` desde un entorno que tenga Prisma y la conexión correcta. **No volver a ejecutar el seed después de rotar el administrador.**

Mantén al menos una copia manual de la base y de los archivos que quieras conservar. Si PDF/OCR no caben en la memoria gratuita o el crédito se agota, no hay garantía de completar la demo en ese servicio: usar temporalmente la API local con túnel o decidir expresamente ampliar sólo el backend.

## Si algo falla

| Síntoma | Revisar |
| --- | --- |
| Railway intenta levantar Next.js o puerto 3000 | Falta el último `FROM api AS railway`, o hay un override de arranque |
| Error `P1001` de Prisma | Host, contraseña codificada, puerto, TLS, pool de sesión, red y restricciones del trial |
| `/health/ready` falla por Storage | Endpoint S3, región, claves S3 correctas, bucket y modo path-style |
| API no arranca por JWT/cookies/recuperación | Secreto aleatorio de 32+ caracteres, HTTPS, `COOKIE_SECURE=true`, recuperación `disabled` |
| Login funciona contra API pero falla desde web | Vercel debe usar `/api`, target Railway terminado en `/api` y redeploy posterior a cambiarlo |
| Error 404/502 desde `/api` en Vercel | Rewrite construido con destino viejo, API caída o puerto público incorrecto |
| Error 413, timeout o reinicio al procesar archivos | Límites reales de proxy, tamaño de carga, RAM y tiempo de OCR/PDF; probar primero un archivo pequeño |
| Chat deshabilitado | Activar paso 10 con base, ruta, modelo y clave reales; revisar salida de red del trial |

Referencias: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Supabase Free](https://supabase.com/pricing), [Prisma en Supabase](https://supabase.com/docs/guides/database/prisma), [S3 Supabase](https://supabase.com/docs/guides/storage/s3/authentication), [Railway Trial](https://docs.railway.com/pricing/free-trial) y [Dockerfiles en Railway](https://docs.railway.com/guides/dockerfiles).
