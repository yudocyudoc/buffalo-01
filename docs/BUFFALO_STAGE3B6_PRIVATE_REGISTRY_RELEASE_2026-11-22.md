# Buffalo original · 3B-6 · publicar OCI en registro privado sin desplegar

**Fecha:** 2026-11-22. Workflow: `.github/workflows/buffalo-private-origin-registry-publish.yml`.

## Objetivo

La build 3B-5 entrega un digest **local** verificado, pero no deja ninguna imagen en `registry.cloudflare.com`; Cloudflare no puede ejecutar esa imagen solo con el hash anotado. Este workflow crea el paso faltante de forma separada de cualquier Container.

### Precondiciones

- Solo en el **push a main que modifica este workflow** intenta publicación. En PR construye, ejecuta las pruebas Node del servidor original con red deshabilitada, y **no** utiliza credenciales de Cloudflare ni publica.
- Exige el secret de GitHub Actions `CLOUDFLARE_API_TOKEN` ya usado por otros workflows del repositorio. Si falta o carece de permiso para Containers Registry, falla cerrado. No crear/presentar secretos en documentación, salidas o logs.
- El `CLOUDFLARE_ACCOUNT_ID` se fija al account ya verificado de este proyecto. Cualquier permiso de token o coste de registro se limita por las políticas reales de la cuenta, no por un cálculo dentro de CI.

### Recorrido de publicación

1. Checkout exacto del commit; imagen base `node:22-bookworm-slim` resuelta a digest.
2. Build local con `BUFFALO_IMAGE_SOURCE_SHA=GITHUB_SHA` y metadata OCI; `npm ci --ignore-scripts` dentro del Dockerfile.
3. Node tests `origin-server.test.mjs` dentro de la propia imagen, con `--network none`, memoria limitada a **256 MiB** (tamaño `lite`), root filesystem read-only, `/tmp` tmpfs, 64 PID máximo. Esto **no** verifica conectividad Cloudflare y no ejecuta modelos.
4. Solo en push a main, `wrangler containers push buffalo-private-origin:$GITHUB_SHA` con secret en environment y sin escribirlo en archivos.
5. Pull independiente desde `registry.cloudflare.com/<ACCOUNT_ID>/buffalo-private-origin:$GITHUB_SHA`. Compara digest de manifiesto local/remoto, `image config`, etiqueta de revisión, usuario `node` y `BUFFALO_IMAGE_SOURCE_SHA`. Ante diferencia, gate FAIL: no desplegar.
6. Publica solo recibo acotado `buffalo-origin-registry-identity-<RUN_ID>` (7 días): no publica la imagen como artifact, ni token, ni variables secretas.

El workflow **no contiene** `wrangler deploy`, `ctx.container.start`, service binding, escritura D1 ni petición a Workers AI. Publicar la imagen no inicia Container.

### Recibos y límites epistemológicos

Un digest de `docker pull` con etiquetas inspeccionadas es evidencia técnica de bytes remotos bajo autenticación del registro, aunque no reemplaza una atestación de supply-chain firmada. El recibo es suficiente como precondición del experimento privado de solo handshake, siempre acompañado de los demás gates de procedencia, commit y modelo en D1. Si el registro reescribe el manifiesto, **no aceptar automáticamente** un digest diferente solo porque el image config parezca coincidir; exigir revisión específica y recibo nuevo.

La primera publicación de imagen puede usar cuota de almacenamiento o tiempo de GitHub Actions. Eso es distinto de cobro de *instancias activas*, que permanece en cero hasta el primer `ctx.container.start()`.

### Pendiente después del push

Registrar un handoff nuevo para ese mismo commit y atestarlo por el workflow GitHub; configurar secretos privados en Cloudflare y el binding `BUFFALO_ORIGIN`, sin exponer el origen. Solo después validar `workerd → Container → WebSocketHandler`. Los agentes seguirán bloqueados.
