# Buffalo Full · 3B-6 · readback de Cloudflare, DO Container-enabled

Fecha: 2026-11-22 (sesión registrada por la API al 2026-11-23 UTC). Esta nota es un recibo de infraestructura, no de handshake.

## Estado confirmado en la cuenta

- Cuenta `e0cb52526a69c0f48f001901a5b9a640`; ningún Worker de BCP ni agente fue modificado.
- Worker privado `buffalo-private-origin-router-lab` desplegado con el código original de `infra/buffalo-origin/container-controller.mjs` del runtime `4396d0fed42f80908b645ef15050fbe657f1a88d`. `workers.dev.enabled=false`, `previews_enabled=false`. Sin secretos y, por tanto, con `configReady` **fail-closed** antes de `BUFFALO_CONTAINER.getByName()`.
- Namespace SQLite `66184492dfb4438aa834baa50652fa9e`, clase `BuffaloHandshakeContainer`. Se creó inicialmente con `migrations`, pero esa vía **no lo hizo Container-enabled**.
- Un intento de crear la aplicación devolvió `HTTP 400 VALIDATE_INPUT durable_objects: Durable Object namespace is not Container-enabled`. Ese error fue causal, no falta de Workers Paid ni de imagen.
- Se creó por la API **nueva de Worker Versions** una versión con `containers:[{class_name:'BuffaloHandshakeContainer'}]` y `exports:{BuffaloHandshakeContainer:{type:'durable-object',storage:'sqlite'}}` (sin legacy `migrations`). Versión `0f4487cd-b15b-4d6f-b511-2a5f7fd24507`, deployment `583bb3cf-7241-4cef-a36d-deb746175334`; se comprobó subdominio deshabilitado y secretos vacíos antes de desplegar.
- La API Cloudflare aceptó entonces la aplicación `buffalo-private-origin-lab` con política `durable_object` y el namespace anterior. **App ID:** `66184492dfb4438aa834baa50652fa9e`. Readback: **0 instancias activas, 0 starting, uso 0 vCPU/0 MiB/0 disco**.
- La preparación del digest `registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/buffalo-private-origin@sha256:a9500540247ddc8c617f381565f67720e8e720c6042381c2e135bd73430a09b9` fue solicitada mediante `POST /containers/image-preparations`. Primer sondeo: `pending`. Segundo sondeo: **`ready`**, artifact digest de preparación `sha256:e8acbf05aa145cdbc55980ad963369ddef69cf606b1a9dd29363efe63d1f2db3`. La preparación de imagen sí se completó, pero **no configura automáticamente `ctx.container.images.base`**.
- El puente `buffalo-original-ws-bridge-lab` conserva solamente binding D1 experimental; aún no existe el binding de servicio privado `BUFFALO_ORIGIN` ni secretos compartidos. **No se hizo handshake**.

## Alineación del repositorio

El archivo `infra/buffalo-origin/wrangler.private-origin.jsonc` cambia de migración legacy a `exports` para la clase DO SQLite. Lo mismo emite el gate offline `stage3b6-preflight.mjs`. Se conservan el digest pinneado, la política `durable_object`, sin URLs públicas, y el nombre fijo de DO. Ningún `max_instances` es afirmado; la política no admite dicho campo.

## Fase aún no resuelta, obligatoria antes del primer arranque

La nueva API de Worker Versions permite adjuntar `containers: [{class_name}]` y declarar `exports`, pero **no suministra el mapa de imágenes nombradas** que el controlador requiere: `this.ctx.container.images.base`. Ese mapa lo construye Wrangler desde `containers[].images.base.image` de la configuración. Consultar [Durable Object Container API](https://developers.cloudflare.com/containers/api/durable-object-container/#images) y [Wrangler configuration](https://developers.cloudflare.com/containers/configuration/wrangler/). **No dar por probado ese mapa** por haber creado la aplicación o preparado la imagen; no sustituirlo por la URL del registro dentro de `start()` sin aval documentado.

Camino de continuación: desplegar con Wrangler a través de una identidad con los permisos necesarios para Workers Scripts y Containers, conservando el origen privado. Después, provisionar secretos de forma segura, conectar bridge únicamente en laboratorio, verificar D1 `SOURCE_ATTESTED`, ejecutar un único handshake y confirmar bloqueo de turnos y uso. Toda la operación de arranque queda prohibida mientras falte un mapa de imagen comprobable.

**No se ha iniciado ningún Container ni ejecutado inferencia.** El handoff Merlin experimental permanece `execution_allowed=0`, 0 grants.
