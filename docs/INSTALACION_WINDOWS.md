# Instalación de Tabelio en la PC de un cliente (Windows)

## 1. En nuestra PC: preparar la entrega

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\preparar-entrega.ps1 -Destino E:\Entrega-Cliente
```

Genera:

| Ruta | Contenido |
| --- | --- |
| `INSTALAR-TABELIO.cmd` | Doble clic para instalar |
| `tabelio\` | Código (sin `node_modules`, builds, `.env` ni `.import-work`) |
| `respaldo\` | `database.dump`, `documentos\`, `backup-metadata.json`, `manifest.sha256` |

Opciones: `-SoloBaseDeDatos` (sin documentos), `-SinRespaldo` (sólo código), `-ArchivoEnv` (otro `.env` de origen).
Los documentos se copian como carpeta (no como un único archivo) para que quepan en USB FAT32.

## 2. En la PC del cliente

1. Copiar la carpeta de entrega completa (por ejemplo al escritorio).
2. Doble clic en `INSTALAR-TABELIO.cmd` y aceptar permisos de administrador.
3. Responder las preguntas iniciales: carpeta del respaldo (se detecta sola), carpeta de documentos,
   correo del administrador, y URL, modelo y clave de la IA (la clave se valida en ese momento).
4. Esperar. El resto es automático.

Qué instala (si no existe ya): Visual C++, Node.js LTS, PostgreSQL 17 (cluster propio `tabelio-postgresql`
en el puerto 55432, independiente de cualquier PostgreSQL existente), LibreOffice, Tesseract con español y Poppler.
Cada componente se busca en la PC, después se intenta con winget y, si falla, se descarga del sitio oficial.
LibreOffice, Tesseract y Poppler son opcionales: si no se pueden instalar, se pueden omitir y la app funciona sin PDF/OCR.

## Resultado

| Elemento | Ubicación |
| --- | --- |
| Aplicación | `C:\Tabelio\app` (con `.env` sólo legible por administradores/SYSTEM) |
| Base de datos | `C:\Tabelio\postgresql-datos`, servicio `tabelio-postgresql` |
| Contraseñas generadas | `C:\Tabelio\config\secretos.json` (sólo administradores) |
| Registros | `C:\Tabelio\logs` (instalación, `api.log`, `web.log`, `vigilante.log`) |
| Arranque | Tarea programada `Tabelio` (SYSTEM, al encender la PC); reinicia la API/web si se caen |
| Accesos directos | `Tabelio` en el escritorio; menú Inicio → Tabelio (Abrir, Reiniciar, Registros) |

## Si algo falla

- Cada paso se reintenta solo y aplica correcciones (limpiar caché de npm, cambiar de puerto, reiniciar el servicio, etc.).
  Si aun así falla, el instalador ofrece Reintentar / Omitir (sólo opcionales) / Cancelar.
- Volver a ejecutar `INSTALAR-TABELIO.cmd` continúa donde se quedó y reutiliza las respuestas.
  `-ReiniciarEstado` vuelve a preguntar todo y repite todos los pasos.
- Para **actualizar** a un cliente: preparar una entrega nueva con `-SinRespaldo` y ejecutarla; el código se
  recopia y recompila, y la base y los documentos del cliente se conservan.
- Cambiar la clave de IA: ejecutar de nuevo el instalador, responder "No" a "¿Usar la configuración previa?"
  y escribir `CONSERVAR` cuando pida el respaldo.
