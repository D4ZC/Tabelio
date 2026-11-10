# Plan de integración de Tabelio: demo gratuita para dos usuarios

Actualizado el 10 de noviembre de 2026. Alcance confirmado: **dos usuarios, pruebas y demostración; sin necesidad de un entorno de producción**. El objetivo es empezar con USD 0 de alojamiento y aceptar suspensión, arranques lentos y disponibilidad durante las sesiones de prueba.

Para ejecutar el despliegue, seguir la [guía paso a paso con comandos y variables](GUIA_DEPLOY_DEMO_GRATUITA.md).

## Qué cambia respecto al plan inicial

La propuesta inicial presupuestaba Vercel Pro, Supabase Pro y una API con recursos de pago. Ese dimensionamiento no corresponde a la demo solicitada. Se conserva como [referencia futura](REFERENCIA_DESPLIEGUE_PILOTO_PAGADO.md), no como requisito para comenzar.

Para la demo se conservan autenticación, permisos por organización y bucket privado, pero se simplifican operación, respaldo y despliegue. No se requieren múltiples réplicas, disponibilidad continua, recuperación automática, un segundo entorno de pago ni una semana de salida gradual.

## Viabilidad de los planes gratuitos

| Servicio | Plan sin pago | Alcance y límite relevante |
| --- | --- | --- |
| Vercel | Hobby | Capacidad razonable para la web y dos usuarios. Sus condiciones restringen el uso a proyectos personales no comerciales; estar en pruebas no determina por sí solo la elegibilidad |
| Supabase | Free | 500 MB de base de datos, 1 GB de archivos y 5 GB de transferencia de salida; suficiente como punto de partida para una muestra pequeña. Puede pausarse tras una semana de inactividad; no incluye los respaldos automáticos de Pro |
| Railway | Trial y después Free | Trial de hasta 30 días o USD 5 consumidos, con hasta 1 GB RAM. Después: USD 1 de crédito gratuito mensual y hasta 512 MB RAM por servicio. El crédito no se acumula |

Railway Free existe y cuesta USD 0 de suscripción, pero ofrece un presupuesto de uso reducido. No equivale a una API con recursos ilimitados o garantizados todo el mes. Las cuentas con trial limitado pueden tener restricciones de red saliente: verificar acceso a PostgreSQL, Storage y proveedor de IA antes de depender de ellas.

La cantidad de usuarios es baja. La incertidumbre principal está en el consumo de **LibreOffice y OCR**, porque son procesos nativos y el backend recibe archivos en memoria. El código permite lotes de hasta diez archivos de 20 MiB y dos lecturas simultáneas; no se puede asegurar ese recorrido completo dentro de 512 MB sin medirlo.

## Ruta recomendada para comenzar

1. Usar **Supabase Free** para una base y un bucket privado con una muestra pequeña, preferentemente datos ficticios o anonimizados.
2. Usar **Vercel Hobby si el proyecto cumple sus condiciones de uso**. Para una prueba vinculada a actividad comercial, elegir un alojamiento cuya modalidad gratuita lo permita o publicar temporalmente la aplicación local.
3. Intentar el contenedor API en **Railway Trial**, sin contratar un plan, y medir login, expediente, documentos, generación PDF, OCR y asistente.
4. Conservar una sola réplica. Mantenerla activa durante cada demostración y aceptar apagarla o suspenderla fuera de las pruebas. Un reinicio descarta confirmaciones y adjuntos pendientes del asistente.
5. Medir el recorrido también dentro del límite posterior de 512 MB antes de considerar viable Railway Free a largo plazo. Si falla, usar la alternativa local durante las pruebas o presupuestar únicamente el backend.

El objetivo es probar la aplicación con el menor costo posible. No prometer todas las funciones en un servicio de 512 MB sin comprobarlas, ni desactivar PDF/OCR silenciosamente para hacer que el despliegue parezca completo.

## Integración mínima

- Separar los builds de Next.js y NestJS. El Dockerfile actual termina en el target `web`; preparar una imagen del target `api` para Railway.
- Ajustar `API_PORT`/`PORT` y las URLs loopback de MCP al puerto elegido. MCP permanece interno y autenticado.
- Ejecutar las migraciones desde el equipo de desarrollo o un job puntual con Prisma, usando la conexión de Supabase compatible con migraciones. No hace falta un servicio de migración siempre activo.
- Conectar Prisma por acceso directo compatible con la red o pool de sesión. Mantener Data API desactivada si no se usa: la autorización actual corresponde a NestJS.
- Conectar el adaptador S3 existente al bucket privado. Credenciales S3, PostgreSQL e IA sólo en backend.
- Mantener cuentas propias para los dos usuarios y un procedimiento administrativo para restablecer contraseñas; el backend todavía no entrega correo real de recuperación.
- Excluir secretos, datos y documentos originales de Git y del contexto Docker antes de publicar el código.

### Acceso sin comprar un dominio

Las URLs gratuitas de Vercel y Railway pertenecen a sitios distintos. Apuntar directamente de `*.vercel.app` a `*.railway.app` no funciona con la cookie actual `SameSite=Lax` para peticiones autenticadas entre sitios.

Para evitar comprar un dominio, intentar **API bajo `/api` en el mismo origen de la web**, mediante rewrite externo hacia el backend. Así la cookie pertenece al host que ve el navegador. Configurar el navegador con `NEXT_PUBLIC_API_URL=/api` y el destino privado con `API_PROXY_TARGET`.

Validar este proxy con login/logout, documentos, tiempos de OCR/PDF y tamaños de carga. El límite de 4.5 MB de Vercel Functions no debe extrapolarse automáticamente a rewrites externos, pero tampoco se debe asumir que cualquier cuerpo o duración funcionará sin prueba. Si no cumple, elegir otro origen único o usar subdominios de un dominio que ya se tenga.

Adaptar el QR móvil a la URL pública `/asistente`, sin direcciones privadas ni certificados locales. El conector de presupuesto IBM necesita autorizar expresamente el origen final si se quiere demostrar; hoy sólo admite `localhost`.

## Prueba para decidir si Railway Free alcanza

Realizar el recorrido con ambos usuarios conectados y observar memoria, CPU, tiempos y crédito consumido:

1. Inicio de sesión, consulta y edición de un expediente.
2. Carga y descarga de un documento pequeño.
3. Generación DOCX y conversión a PDF.
4. OCR de una identificación o PDF corto.
5. Asistente y confirmación de una acción.
6. Reinicio y nueva sesión, comprobando que los datos guardados permanezcan en Supabase.

Si hay falta de memoria, probar primero archivos pequeños, una operación pesada a la vez y menos páginas OCR. Reducir límites en la configuración y en la interfaz de manera coherente. Limitar el heap de Node no limita la memoria de LibreOffice o Tesseract.

Durante esta etapa basta con un respaldo manual antes de cambios relevantes: exportar la base y copiar los archivos que se quieran conservar. Los respaldos de base no incluyen los binarios de Storage. No prometer recuperación de producción para esta demo.

## Alternativas si el backend gratuito no alcanza

**Costo de alojamiento USD 0 y funciones completas:** ejecutar web y API en la computadora actual y publicar la web mediante un túnel HTTPS temporal. El proxy `/api` existente mantiene las peticiones en un solo origen; LibreOffice y OCR usan los recursos de la computadora. Requiere mantenerla encendida y conectada durante la prueba. Cloudflare Quick Tunnels permite una URL temporal sin dominio ni cuenta; no admite SSE, por lo que hay que comprobar cualquier streaming público necesario. El MCP actual se comunica internamente por loopback.

**Vercel + API local:** usar un rewrite de Vercel hacia un túnel de la API; requiere la misma validación de cookies, tamaños y tiempos del proxy. También está sujeto a las condiciones de Vercel Hobby.

**Render Free como reemplazo de Railway:** ofrece un servicio web gratuito con 512 MB y suspensión después de 15 minutos sin tráfico; el siguiente arranque tarda aproximadamente un minuto. Evita depender del crédito mensual de Railway para ese servicio, pero no resuelve por sí mismo la memoria de PDF/OCR. Verificar además cuotas compartidas de tráfico y builds.

## Costo esperado y aceptación

- **Alojamiento inicial: USD 0**, dentro de las cuotas, disponibilidad de los planes y condiciones de uso. No contratar Pro como paso inicial de esta demo.
- Railway Trial es temporal; Railway Free posterior tiene crédito y recursos más limitados. Revisar consumo antes de cada sesión.
- El proveedor de IA puede generar consumo por separado, aunque el alojamiento sea gratuito.
- La demo se considera lista cuando ambos usuarios completan el recorrido acordado, los documentos persisten en Supabase y se han comprobado reinicios, acceso móvil y límites reales.
- Si los planes gratuitos no soportan alguna función, registrar esa limitación y elegir la alternativa local o un cambio de recursos explícito.

## Fuentes verificadas

- [Vercel Hobby: condiciones y cuotas](https://vercel.com/docs/plans/hobby).
- [Supabase Free: precios y límites](https://supabase.com/pricing).
- [Railway Trial](https://docs.railway.com/pricing/free-trial), [planes y crédito gratuito](https://docs.railway.com/pricing/plans) y [precios](https://railway.com/pricing).
- [Render Free](https://render.com/docs/free) y [recursos por plan](https://render.com/pricing).
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

Datos consultados el 10 de noviembre de 2026. No se han creado servicios ni efectuado despliegues con esta revisión.
