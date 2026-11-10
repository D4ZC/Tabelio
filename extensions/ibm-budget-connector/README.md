# Conector local de presupuesto IBM para Chrome

Extensión Manifest V3 para la demo en **http://localhost:3000**. No necesita compilarse ni una API key. Conserva la sesión W3 en el perfil de Chrome; consulta el endpoint de presupuesto desde una pestaña de IBM Usage y transmite sólo sus campos de créditos a la demo conectada.

## Instalar y conectar

1. Abre Chrome en el perfil donde usarás la demo. Ve a `chrome://extensions`.
2. Activa **Modo desarrollador**, pulsa **Cargar descomprimida** y selecciona esta carpeta: `/Users/d4zc/Documents/Demo Despacho/extensions/ibm-budget-connector`.
3. Abre [IBM Usage](https://servicesessentials.ibm.com/settings/usage) en ese mismo perfil e inicia sesión con W3. La sesión del navegador integrado de Codex no se transfiere a Chrome.
4. Abre [la demo local](http://localhost:3000/asistente). Si estas pestañas ya estaban abiertas al instalar la extensión, recarga ambas.
5. Con la demo como pestaña activa, abre **Presupuesto IBM** desde el menú de extensiones de Chrome y pulsa **Conectar esta demo**.
6. Mantén Usage abierta y pulsa **Actualizar** en la barra del chat. Los créditos individuales son el acumulado de todos tus equipos; el detalle muestra además el presupuesto compartido del equipo configurado.

Puedes revocar el acceso desde **Desconectar** en el mismo popup o retirar la extensión en `chrome://extensions`. Tras modificar archivos de la extensión, pulsa su botón de recarga en Chrome y recarga las dos pestañas.

## Permisos y datos

- `activeTab`: comprueba al conectar que tienes abierta la demo local autorizada.
- `storage`: guarda únicamente la aprobación `demoConnected`; no persiste presupuesto ni credenciales.
- Acceso a `https://servicesessentials.ibm.com/*`: localiza Usage y permite su content script. La petición se hace desde IBM con la sesión normal del navegador.
- Content script local restringido a `http://localhost:3000/*`; worker y scripts comprueban también el origen exacto, puerto y frame superior.

La página local sólo puede pedir estado o presupuesto por `teamId`; la extensión construye una URL GET fija. No ofrece un proxy genérico. No usa permisos `cookies`, `webRequest`, `debugger` ni lee los valores de las cookies. No devuelve el cuerpo completo de IBM ni lo envía al backend. Una caché en memoria limita la consulta a una cada 30 segundos por equipo; el chat actualiza su saldo cada minuto y al volver a enfocarse.

Si falta Usage o su sesión caducó, vuelve a abrirla e inicia sesión. Si IBM impide cargar la extensión por políticas corporativas, se requiere un conector aprobado por tu organización.

## Verificación

Desde la raíz del proyecto: `node --test extensions/ibm-budget-connector/test/*.test.mjs`.

Las pruebas simulan Chrome e IBM y verifican los límites del puente. La validación real requiere instalar la extensión e iniciar sesión en Chrome. El costo por operación permanece pendiente si IBM no devuelve un importe verificable por solicitud; los cambios del presupuesto no se reparten entre operaciones.
