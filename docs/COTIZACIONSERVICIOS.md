# Cotización de servicios en la nube — Tabelio

| | |
| --- | --- |
| **Cliente** | Corporativo Clerc |
| **Proyecto** | Publicación de Tabelio en la nube (acceso web y móvil) |
| **Fecha** | 26 de noviembre de 2026 |
| **Vigencia** | 30 días naturales |
| **Moneda** | Dólares estadounidenses (USD), antes de impuestos |

---

## 1. Resumen

Para que Tabelio funcione en Internet, con acceso seguro desde cualquier computadora o celular, se necesitan cinco servicios de terceros y la API de inteligencia artificial de Claude (Anthropic), que alimenta el asistente.

| Concepto | Mensual (estimado) | Anual (estimado) |
| --- | ---: | ---: |
| Infraestructura (web, servidor, base de datos, archivos, respaldos, dominio) | USD 74.25 | USD 891.00 |
| Inteligencia artificial — API de Claude (uso medio) | USD 150.00 | USD 1,800.00 |
| Membresía Claude Pro (soporte y mantenimiento) | USD 20.00 | USD 240.00 |
| **Total estimado** | **USD 244.25** | **USD 2,931.00** |

Según el uso real, el rango esperado va de **USD 127 a USD 422 al mes**, es decir, de **USD 1,527 a USD 5,060 al año** (detalle en la sección 4). La mayor parte de la variación viene del uso del asistente de IA.

---

## 2. Servicios requeridos

### 2.1 Vercel Pro — sitio web
- **Qué hace:** publica la aplicación web que usan los abogados y el personal desde el navegador y el celular.
- **Por qué el plan Pro:** el plan gratuito solo se permite para proyectos personales no comerciales. Tabelio dará servicio a un despacho, así que se requiere el plan comercial.
- **Costo:** USD 20 al mes por un asiento de administración. Los usuarios del despacho **no** pagan asiento: el número de usuarios de Tabelio no cambia este costo.

### 2.2 Railway — servidor de la aplicación
- **Qué hace:** ejecuta el motor de Tabelio: permisos, expedientes, generación de documentos Word y PDF, lectura de identificaciones y documentos escaneados (OCR) y conexión con el asistente.
- **Por qué es necesario:** la generación de PDF y el OCR requieren programas instalados en un servidor propio, que no pueden ejecutarse en Vercel.
- **Configuración:** un servidor siempre encendido con hasta 2 GB de memoria.
- **Costo:** se cobra por consumo. Estimado de USD 15 a USD 40 al mes; valor de referencia: **USD 25**.

### 2.3 Supabase Pro — base de datos y almacenamiento de documentos
- **Qué hace:** guarda la información de clientes, expedientes y usuarios, y almacena los documentos en un repositorio privado.
- **Por qué el plan Pro:** el respaldo actual de documentos del despacho ocupa unos **21 GB** y el plan gratuito solo admite 1 GB. Además, el plan gratuito se pausa si no hay actividad y no tiene respaldos automáticos.
- **Incluye:** base de datos de 8 GB, **100 GB de almacenamiento de archivos**, 250 GB de transferencia mensual y respaldo diario de la base de datos con 7 días de retención.
- **Costo:** USD 25 al mes. Solo habría cargos adicionales si se rebasan esos límites o se requiere un servidor de base de datos más grande (se reservan hasta USD 10 en el escenario alto).

### 2.4 Copia independiente de documentos — Cloudflare R2 o Backblaze B2
- **Qué hace:** guarda una segunda copia de los documentos fuera de Supabase. El respaldo de Supabase protege los datos, pero **no los archivos**, y un archivo borrado no se recupera por ese medio.
- **Costo:** de USD 1 a USD 5 al mes para el volumen actual (unos USD 0.015 por GB al mes). Valor de referencia: **USD 3**.

### 2.5 Dominio propio
- **Qué hace:** da una dirección propia, por ejemplo `app.<dominio>` y `api.<dominio>`. Así el inicio de sesión funciona de forma segura en todos los navegadores y la aplicación tiene una imagen profesional.
- **Costo:** de USD 15 a USD 20 al año (de USD 1.25 a USD 1.67 al mes). Si el despacho ya tiene un dominio, se puede usar un subdominio sin costo adicional.

### 2.6 API de Claude (Anthropic) — asistente de inteligencia artificial
- **Qué hace:** da servicio al asistente de Tabelio: consultas en lenguaje natural sobre expedientes, lectura y extracción de datos de documentos, y redacción.
- **Modelo configurado:** Claude Opus 5.5.
- **Cómo se cobra:** solo por uso, con saldo prepagado en la consola de Anthropic. No hay renta fija.

| Tarifa oficial (Claude Opus 5.5) | USD por millón de tokens |
| --- | ---: |
| Texto enviado al modelo (entrada) | 4.00 |
| Texto generado por el modelo (salida) | 20.00 |

Un millón de tokens equivale aproximadamente a 750,000 palabras. Como referencia, **una consulta típica al asistente cuesta unos USD 0.15**. Este estimado incluye el contexto del expediente, las herramientas que usa el asistente y la respuesta.

| Escenario de uso | Consultas al mes | Costo mensual estimado |
| --- | ---: | ---: |
| Bajo (uso ocasional) | ~300 | USD 45 |
| Medio (uso diario de varios usuarios) | ~1,000 | USD 150 |
| Alto (uso intensivo) | ~2,000 | USD 300 |

Opciones para reducir este costo:
- **Modelo Claude Sonnet 5.5:** cuesta la mitad (USD 2 / USD 10 por millón de tokens). Es adecuado para la mayoría de las consultas cotidianas.
- **Límite de gasto mensual:** se configura en la consola de Anthropic para que el gasto nunca rebase un monto acordado.
- La lectura local de documentos que hace Tabelio (sin IA) no genera ningún cargo.

Privacidad: según sus términos comerciales, Anthropic no usa por defecto la información enviada por la API para entrenar sus modelos.

### 2.7 Membresía Claude Pro — soporte y mantenimiento
- **Qué hace:** es la herramienta de desarrollo con IA que se usa para dar mantenimiento, corregir incidencias y hacer mejoras a Tabelio.
- **Importante:** la membresía **no** da servicio a la aplicación; eso lo hace la API (punto 2.6). Son contrataciones distintas.
- **Costo:** USD 20 al mes. Si el volumen de mejoras lo requiere, existe el plan Claude Max (de USD 100 a USD 200 al mes), que no está incluido en esta cotización.

---

## 3. Desglose mensual y anual (escenario de referencia)

| # | Servicio | Proveedor | Mensual (USD) | Anual (USD) |
| --- | --- | --- | ---: | ---: |
| 1 | Sitio web | Vercel Pro | 20.00 | 240.00 |
| 2 | Servidor de la aplicación | Railway | 25.00 | 300.00 |
| 3 | Base de datos y documentos | Supabase Pro | 25.00 | 300.00 |
| 4 | Copia independiente de documentos | Cloudflare R2 / Backblaze B2 | 3.00 | 36.00 |
| 5 | Dominio | Registrador de dominios | 1.25 | 15.00 |
| | **Subtotal infraestructura** | | **74.25** | **891.00** |
| 6 | Asistente de IA (uso medio) | Anthropic — API de Claude | 150.00 | 1,800.00 |
| 7 | Soporte y mantenimiento con IA | Anthropic — Claude Pro | 20.00 | 240.00 |
| | **Total estimado** | | **244.25** | **2,931.00** |

---

## 4. Escenarios

| Servicio | Bajo | Referencia | Alto |
| --- | ---: | ---: | ---: |
| Vercel Pro | 20.00 | 20.00 | 20.00 |
| Railway | 15.00 | 25.00 | 40.00 |
| Supabase Pro | 25.00 | 25.00 | 35.00 |
| Copia de documentos | 1.00 | 3.00 | 5.00 |
| Dominio | 1.25 | 1.25 | 1.67 |
| API de Claude | 45.00 | 150.00 | 300.00 |
| Claude Pro | 20.00 | 20.00 | 20.00 |
| **Total mensual** | **127.25** | **244.25** | **421.67** |
| **Total anual** | **1,527.00** | **2,931.00** | **5,060.04** |

**Recomendación:** presupuestar el escenario de referencia más una reserva del 10 al 15% para excedentes de consumo. Eso equivale a unos **USD 270–280 al mes** (**USD 3,250–3,400 al año**). Después de los primeros dos meses de uso real se ajustará la proyección con el consumo medido.

---

## 5. Supuestos de la cotización

1. De 2 a 10 usuarios internos del despacho trabajando de forma simultánea.
2. Hasta 100 GB de documentos almacenados. El volumen actual es de unos 21 GB.
3. Archivos de hasta 20 MB por documento.
4. Un solo entorno de producción. Un entorno adicional de pruebas permanente incrementaría el costo de infraestructura.
5. Precios públicos de los proveedores consultados en noviembre de 2026. Pueden cambiar sin previo aviso por parte de cada proveedor.
6. Los servicios de Railway, Supabase (excedentes) y Anthropic se cobran por consumo. Las cifras son estimaciones y no tarifas fijas.

## 6. Impuestos, tipo de cambio y forma de pago

- Los importes **no incluyen impuestos**. Los proveedores extranjeros de servicios digitales pueden trasladar **IVA del 16%** a clientes en México.
- Los proveedores cobran en **USD con tarjeta de crédito o débito internacional**. La conversión a pesos depende del tipo de cambio del día de cada cargo y de las comisiones del banco emisor.
- Los cargos de Vercel, Supabase, Railway y Claude Pro son mensuales. La API de Claude funciona con saldo prepagado: se recomienda una recarga inicial de USD 50 a USD 100 con recarga automática y límite de gasto.

## 7. Titularidad de las cuentas

Se recomienda que **todas las cuentas se abran a nombre del despacho** y con su forma de pago, con el proveedor de tecnología como colaborador o administrador. Así el despacho:
- conserva la propiedad de sus datos y documentos en todo momento;
- recibe directamente las facturas de cada proveedor;
- puede cambiar de proveedor de tecnología sin migrar la información.

## 8. Qué incluye y qué no incluye esta cotización

**Incluye** (costos de terceros):
- Alojamiento de la aplicación web y del servidor.
- Base de datos con respaldo diario y almacenamiento privado de documentos.
- Copia independiente de los documentos.
- Dominio.
- Consumo estimado del asistente de IA.
- Herramienta de IA para soporte y mantenimiento.

**No incluye:**
- **Servicios profesionales**, cotizados por separado:
  - configuración inicial y publicación (estimado de 4 a 7 días hábiles);
  - migración de los documentos y expedientes actuales;
  - capacitación;
  - soporte mensual y desarrollo de nuevas funciones.
- Envío de correos automáticos (por ejemplo, recuperación de contraseña por correo). En esta etapa, la recuperación de acceso la hace un administrador.
- Entornos adicionales, más de 100 GB de documentos o más de 10 usuarios simultáneos. Si el uso crece, se presentará una actualización de esta cotización.
- Impuestos y comisiones bancarias.

| Servicios profesionales | Importe |
| --- | ---: |
| Configuración inicial y publicación (pago único) | _Por definir_ |
| Migración de información existente (pago único) | _Por definir_ |
| Soporte y mantenimiento mensual | _Por definir_ |

## 9. Seguridad y continuidad

- Conexión cifrada (HTTPS) en todo momento.
- Documentos en un repositorio privado: solo se accede a ellos a través de Tabelio, con usuario y permisos por rol.
- Las claves de acceso a la base de datos y a la IA residen únicamente en el servidor, nunca en el navegador.
- Respaldo diario de la base de datos (7 días) más una copia independiente de los documentos.
- Objetivo inicial: pérdida máxima de 24 horas de información y recuperación en unas 4 horas ante una falla mayor. Este objetivo se confirmará con una prueba de restauración; no es una garantía de los proveedores.

---

_Cotización elaborada con base en las tarifas públicas de Vercel, Railway, Supabase, Cloudflare/Backblaze y Anthropic vigentes en noviembre de 2026. Los costos de consumo son estimaciones y se ajustarán según el uso real._
