# Buffalo Full · Etapa 3B-5: imagen del origen privado, build local y prueba sin inferencia

Fecha: 2026-11-22. Alcance: PR de CI y Dockerfile; no ejecución de agentes, proveedor ni Cloudflare Containers.

## Qué se valida

El workflow `.github/workflows/buffalo-private-origin-image-ci.yml` se ejecuta en PRs relevantes y en `main` tras el merge:
1. Checkout exacto de `GITHUB_SHA`, sin credenciales persistidas ni modificaciones de trabajo.
2. Resolución del Node 22 base a referencia inmutable `node@sha256:...`; la imagen se construye con ese `FROM` concreto en vez de depender de una etiqueta móvil en el instante de build.
3. Buildx local `linux/amd64` con `BUFFALO_IMAGE_SOURCE_SHA` del checkout y etiquetas de procedencia; `--load` sin push a registro, despliegue, API de Cloudflare ni credenciales.
4. Ejecución **dentro de la imagen construida**, con `--network none`, `--read-only` y `/tmp` efímero, de las cuatro pruebas Node originales del origen: handshake genuino y denegaciones de prewarm/turno/upgrade. Esto **no** equivale a una conexión con workerd.
5. Validación de `containerimage.digest` de Buildx, `image.Id` de Docker, identidad de commit en la configuración efectiva, etiquetas, usuario `node` y puerto 8080. Comprobación básica de exclusión de `.env`, Git, GitHub, docs y Wrangler del filesystem final.
6. Publicación por GitHub Actions de un JSON de recibo de identidad (7 días). No se publica la imagen, no se firma una atestación OCI de registro y no se escribe `SOURCE_ATTESTED` en D1.

## Distinciones importantes

- El `source_commit` se corresponde con el checkout del **run que hizo el build**. Un PR probado contra un commit de merge temporal no prueba por sí mismo la imagen del futuro commit final de `main`. Por eso existe también el trigger de push a main.
- `image_manifest_digest` es el digest devuelto por el **build local**, no un digest confirmado de un registro Cloudflare. `image_config_digest` identifica la configuración de la imagen cargada; ambos se conservan separados.
- `BUFFALO_IMAGE_SOURCE_SHA` y las etiquetas son afirmaciones incluidas en el build. El recibo CI enlaza esas afirmaciones con una ejecución, pero **no es una atestación independiente firmada ni un certificado de despliegue**.
- El Node base queda fijado por digest **por ejecución**. Diferentes builds pueden resolver distintos digest base si la etiqueta upstream cambió; la comparación debe usar el recibo, no asumir imágenes idénticas por tener el mismo commit.
- La imagen sigue siendo **handshake-only**, no una imagen para Buffalo Full operativo: no incluye Python/PySD, no autoriza Merlin ni expone herramientas.
- GitHub Actions puede consumir minutos de CI según el plan del repositorio, aunque esta fase no usa Cloudflare facturable.

## Próximo gate

Tras un run verde del **commit definitivo de main**, conservar su recibo y comparar el digest OCI de la imagen que realmente se suba a un registro autorizado. Si la imagen fue reconstruida, exigir nuevo recibo: no asumir igualdad de bytes ni de digest.

El siguiente trabajo, con autorización específica y presupuesto, será establecer una aplicación Containers privada y un binding de servicio; verificar secretos, políticas, imagen y SHA del modelo; y ejecutar **un único handshake real workerd→Container**. El primer `start()` de Container y cualquier despliegue facturable permanecen prohibidos por esta entrega. No hay cambios en agentes, D1 o Workers productivos.
