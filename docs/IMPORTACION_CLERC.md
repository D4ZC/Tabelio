# Importación del respaldo de Corporativo Clerc

Carga la información real de Corporativo Clerc, S.C. (Centro Privado de Métodos Alternos n.º 100, IJA Jalisco)
desde el respaldo recuperado de Dropbox para que el despacho pruebe Tabelio con sus propios expedientes.

> Contiene datos personales reales (INE, domicilios, prediales, escrituras). Ejecútalo sólo en entornos
> autorizados por Clerc y nunca subas el manifiesto, los textos ni `storage/` al repositorio.

## Origen

| Carpeta del respaldo (`Red.Notaria Dropbox/Isabel Reyes/CLERC`) | Destino en Tabelio |
| --- | --- |
| `CONTROL/2026/<mes más reciente>.xlsx` (hojas 2018–2026) | Un expediente `MEDIATION_AGREEMENT` por fila (`EXP ####`; en 2018, `CONV n/aaaa`) con partes, inmueble, datos de mediación y notas (solicitó, elaboró, firma, IJA, sanción, cobro, vencimiento, póliza) |
| `CONVENIOS 2015-2022 … 2026/<carpeta EXP>` | Documentos del expediente correspondiente (se cruza por número de expediente o de convenio) |
| `CONVENIOS */CANCELADOS`, `CONCLUSIONES` | Estado cancelado / cerrado |
| `CONTROL/Registro Caviace.xlsx` | Clave catastral e inquilinos para los convenios de Caviace |
| `DOCUMENTOS CLIENTES/*` | Documentos de la persona (Caviace, Beckmann, Banorte) en el directorio |
| `TRANSACCIONES/*` | Expedientes `TRANS …` |
| `FORMATOS CONVENIOS/*` | Biblioteca jurídica, colección `clerc-formatos` (con texto extraído por LibreOffice) |
| `Copias encontradas en …/CLERC` | Sólo los archivos cuyo contenido no está en la carpeta principal |

**No se importa:** `DOCUMENTOS CLERC` (FIEL/CSD, SAT, IMSS, cotizaciones Banorte, asuntos propios del despacho),
los archivos sueltos de la raíz de `CLERC`, ni temporales (`~WRL*.tmp`, `.crdownload`, `.pst`, `.url`, `download.htm`).

## Reglas de transformación

- **Estado:** `CANCELADO` o carpeta `CANCELADOS` → Cancelado; números reasignados ("se pasa a 2025", "duplicado") → Cancelado con motivo;
  `PENDIENTE FIRMA` → Firma; `EN PROCESO`/`ELABORANDO` → Redacción; sin número de convenio → Integración;
  con convenio → Activo si el arrendamiento no ha vencido (o se firmó hace menos de un año), si no, Cerrado.
- **Partes:** "P Solicitante" → parte solicitante, "Complementaria"/"Complementaria A" → parte complementaria.
  Las cláusulas de representación ("por conducto de su apoderado…", "como apoderada de…") se separan: el titular queda como parte
  y el apoderado con rol *Representante*. Las personas se deduplican por nombre normalizado.
- **Fechas:** si la fecha del convenio no coincide (±1 año) con el año del número de convenio, se usa la fecha de solicitud y la original queda en notas.
- **Mediación:** centro "Corporativo Clerc, S.C.", acreditación 100; facilitador según la columna *Firma*
  (Saúl → José Saúl Ávila Gutiérrez Hermosillo, Alex → Alejandro Jhovaney Ávila Gutiérrez Hermosillo, Amor → Amor Isabel Reyes Fernández).
  La certificación no se infiere porque cambió con los años.
- **Documentos:** un solo documento tipificado por expediente para convenio firmado (PDF), contrato (anexo) y predial/escritura;
  el resto como *Otro* (los tipificados sin persona se reemplazarían entre sí). Duplicados exactos dentro del mismo expediente se omiten.
- **Checklist:** se calcula con las reglas del dominio; en expedientes históricos (activos, cerrados, cancelados) lo no capturado queda *Dispensado*
  con motivo; en los que siguen en trámite queda *Pendiente*.

## Ejecución (Windows, local)

```powershell
# 1. Analizar el respaldo (sólo lectura; calcula SHA-256 de ~22 GB, ~10 min)
python -I scripts/clerc/analyze.py "D:\RespaldoRecuperadoDropbox" "D:\TabelioWork\manifest.json"
# 2. Extraer texto de los formatos para la biblioteca (LibreOffice)
python -I scripts/clerc/extract_texts.py D:\TabelioWork\manifest.json D:\TabelioWork\texts
# 3. Compilar e importar (idempotente; --dry-run muestra conteos sin escribir)
npm run build
npm run clerc:import -- --manifest D:/TabelioWork/manifest.json --texts D:/TabelioWork/texts
```

La primera ejecución crea la organización `clerc` y la cuenta `admin@clerc.local` con una contraseña aleatoria que se muestra una sola vez.
`--reset --yes-delete-imported-data` borra lo importado de esa organización antes de reimportar (sólo para pruebas).

Arranque local en Windows sin Docker: PostgreSQL 17 como servicio en el puerto 55432 y `npm run dev:win`.

## Resultado de referencia (respaldo al 10/11/2026)

6,553 expedientes (6,516 filas del registro + carpetas sin fila), ~15,200 documentos (≈21 GB), ~9,500 personas,
~3,800 inmuebles y 228 formatos.

## Antes de publicar en Vercel + Supabase

- **Almacenamiento:** ~21 GB de documentos. El plan gratuito de Supabase Storage (1 GB) no alcanza; se requiere plan de pago.
  Configura `STORAGE_DRIVER=s3` con el endpoint S3 de Supabase y vuelve a ejecutar el importador apuntando a la base de Supabase:
  usa el mismo `ObjectStorageService`, así que sube los objetos al bucket configurado.
- **Base de datos:** ~6.5 k expedientes y ~15 k documentos caben en el plan gratuito de Postgres, pero la importación debe
  correrse desde una máquina con acceso al respaldo (no desde Vercel).
- **Privacidad:** son datos personales sensibles de terceros (LFPDPPP). Confirma con Clerc el aviso de privacidad y el consentimiento
  antes de subirlos; considera publicar primero sin documentos (`--skip-files`) o con un subconjunto.
