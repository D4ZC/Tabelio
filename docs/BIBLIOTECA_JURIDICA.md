# Biblioteca jurídica de referencias

La biblioteca conserva los documentos organizados de Saul y Alex dentro de una organización de Tabelio. Cada procedencia tiene su propio registro consultable y descargable; los archivos binarios idénticos comparten almacenamiento dentro de esa organización. No crea expedientes ni activa plantillas de generación. La clasificación jurídica se conserva separada del tipo documental operativo de un expediente.

La carga inicial de esta colección en la organización local `demo-despacho` y la reejecución sin cambios están registradas en [integracion-aplicacion.json](../documentos-organizados/saul-alex/integracion-aplicacion.json). Ese comprobante describe la importación realizada; el catálogo original conserva el estado de preparación documentado antes de la integración.

## Preparación

Aplica las migraciones y genera el cliente Prisma y la API con la configuración del entorno de destino:

```bash
npm run db:deploy
npm run db:generate
npm run build -w @despacho/database
npm run build -w @despacho/api
```

Ejecuta los comandos siguientes desde la raíz del proyecto. Se reutilizan `PrismaService`, `ObjectStorageService` y la validación de configuración de la API en un contexto Nest mínimo. No se abre un puerto HTTP ni se arrancan las tareas periódicas de la aplicación. El contexto cierra sus conexiones al terminar.

El importador usa `DATABASE_URL`, `STORAGE_DRIVER`, `LOCAL_STORAGE_PATH` y las opciones `S3_*` de la aplicación. Carga `.env` desde el directorio actual y el proyecto; las variables del proceso tienen prioridad. La validación de configuración exige los mismos parámetros básicos, incluido `JWT_SECRET`.

## Vista previa e importación

```bash
npm run library:import -- --organization demo-despacho --dry-run
npm run library:import -- --organization demo-despacho
```

`--organization` acepta un ID o slug existente. Sólo puede omitirse si la base contiene exactamente una organización. La ejecución nunca crea organizaciones ni distribuye los documentos entre varias. `--actor` permite seleccionar por ID o correo a un administrador activo de esa misma organización; si se omite, se usa su primer administrador activo existente. Se exige un administrador para registrar la autoría y la auditoría.

La salida sólo muestra conteos. `--dry-run` comprueba fuentes, catálogo, base y objetos ya almacenados sin escribir registros, archivos ni auditoría. Sus conteos de creación o actualización representan cambios propuestos.

Opciones de ubicación:

```bash
npm run library:import -- --organization ORGANIZACION \
  --root /ruta/documentos-organizados/saul-alex \
  --source-root /ruta/que-contiene-Saul-y-Alex \
  --dry-run
```

`--root` apunta al paquete de catálogo; por defecto es `documentos-organizados/saul-alex` dentro del directorio actual. `--source-root` contiene las carpetas originales `Saul` y `Alex`; su valor predeterminado es el directorio actual. Los originales también deben estar disponibles para verificar sus hashes. No se modifican las fuentes ni el paquete organizado.

Antes de almacenar archivos se validan todas las copias, originales, extracciones UTF-8, hashes binarios y de texto, revisiones por documento, cobertura de paquetes y referencias de duplicados. Las rutas relativas y sus enlaces simbólicos deben permanecer dentro de la raíz correspondiente. Se rechazan fuentes nuevas sin revisar, revisiones desactualizadas, rutas repetidas y copias faltantes o sobrantes.

## Reintentos e integridad

La colección tiene el identificador estable `saul-alex`. La clave única de registro es `(organizationId, collectionId, externalId)`, donde `externalId` conserva el ID del catálogo. Un reintento conserva el ID y la fecha de creación del registro; si sus metadatos son iguales, también conserva su fecha de actualización. Las 142 procedencias se conservan aunque existan sólo 127 contenidos binarios distintos.

Los objetos usan una clave por organización y SHA-256. El importador lee y comprueba el hash de cualquier objeto existente antes de reutilizarlo. Si una escritura local encuentra `EEXIST`, verifica el objeto de nuevo. Un contenido diferente provoca una falla y nunca se sobrescribe automáticamente. Los objetos S3 se comprueban mediante lectura completa, sin depender de ETag.

Las altas y actualizaciones de registros se confirman junto con un evento `LEGAL_LIBRARY_IMPORTED` en una transacción. Una falla posterior a identificar organización y administrador intenta registrar `LEGAL_LIBRARY_IMPORT_FAILED`, sin incluir nombres ni texto documental. Si falla la base, puede no ser posible registrar ese evento. Los objetos ya escritos permanecen disponibles para un reintento; no se eliminan ni se modifican fuentes como compensación. Los registros ausentes de un catálogo posterior no se borran automáticamente.

`duplicateOf` y `textEquivalentTo` contienen IDs externos del catálogo de la misma colección, no IDs internos de Prisma. La coincidencia de texto se conserva por separado y nunca se usa para consolidar binarios. El JSON `review` contiene `notes`, `blockers`, `fields`, `subdocuments` y `confidence`. Se normaliza `familiar` a `divorcio`, `justicia_alternativa` a `administrativo` y la materia contradictoria de préstamo/arrendamiento a `materia_por_revisar`; cada cambio conserva la materia original en una nota.

## Contenedor y verificación

La imagen de API incluye el CLI. Monta el catálogo y las fuentes originales como sólo lectura y utiliza el mismo volumen de almacenamiento y configuración que la API. Por ejemplo, con los servicios de Compose en ejecución:

```bash
docker compose exec api node scripts/import-legal-library.mjs --help
```

Para importar desde un contenedor, las rutas de `--root` y `--source-root` deben existir dentro de él. El catálogo y las fuentes no se incluyen automáticamente en la imagen de API. El CLI no necesita `textutil`: consume las extracciones ya verificadas del paquete.

```bash
npm run test:library
```

Las pruebas cubren rechazo de revisiones, archivos y rutas alteradas, fuentes sin revisar, relaciones de duplicados inválidas, normalización de materia y reintentos de almacenamiento sin sobrescribir objetos corruptos.
