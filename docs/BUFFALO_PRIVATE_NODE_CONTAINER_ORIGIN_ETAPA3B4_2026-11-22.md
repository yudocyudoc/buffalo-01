# Buffalo original · Etapa 3B-4: origen Node/Linux privado para Cloudflare Container

**Fecha:** 2026-11-22 UTC.  
**Alcance:** preparación de origen privado y pruebas del servidor original, sin desplegar un Container de pago.

## Decisión de arquitectura

Buffalo original **ya** tiene `WebSocketHandler`, `SessionManager`, `WorkerSpawner`, protocolo `/api/v1`, adaptador a Cloudflare AI y operaciones de usuario. No se deben modificar esos componentes ni reemplazar la sesión original por un workflow batch.

Topología objetivo:

```text
Cliente Buffalo original
    ↓ WebSocket /v1/lab/original-ws
buffalo-original-ws-bridge-lab (Worker aislado, D1 lectura y gate)
    ↓ service binding BUFFALO_ORIGIN, destino fijo /api/v1
buffalo-private-origin-container-router (Worker privado)
    ↓ Durable Object con ctx.container, puerto TCP 8080
Contenedor Linux privado, Node 22
    ↓ WebSocket original, filtro de entrada handshake-only
WebSocketHandler + SessionManager ORIGINALES
    X WorkerSpawner.spawn BLOQUEADO en origen
    X select_agent / chat / tools BLOQUEADOS en ambos extremos
```

## Cambios efectivos de código

- `infra/buffalo-origin/origin-server.mjs`: levanta un servidor Node en puerto 8080 con `WebSocketServer({noServer:true})`, `WebSocketHandler` original y `SessionManager` original. La ruta `/api/v1` solo acepta un upgrade que incluya la clave interna `x-buffalo-origin-token`. `/health` devuelve 204 (servidor interno).
- En el proceso del **origen**, el wrapper reemplaza en memoria `WorkerSpawner.spawn` por un rechazo determinista y envuelve el WebSocket antes de entregarlo al handler original. Permite una sola `initialize_session` con auth, `clientId` controlado y SHA del modelo, y luego solo `disconnect`. No permite `select_agent`, `chat`, archivos, historial ni herramientas. Cualquier desvío cierra la conexión con 1008.
- `infra/buffalo-origin/Dockerfile`: imagen Node 22 con `npm ci --omit=dev --ignore-scripts`, `USER node` y `CMD` al servidor de solo handshake. **No hay Python/PySD en esta imagen**, porque no se ejecutan agentes. Eso no es todavía un contenedor para Buffalo completo. `.dockerignore` excluye credenciales, node_modules, artefactos y documentos.
- `infra/buffalo-origin/container-controller.mjs`: código para un Worker+Durable Object bajo la **API de Containers de noviembre de 2026**, con `ctx.container.start({ image: ctx.container.images.base, instance: 'lite', enableInternet:false })`, readiness por `getTcpPort(8080).fetch('/health')` y reenvío WebSocket por `getTcpPort(8080).fetch()`; no utiliza el adaptador antiguo `@cloudflare/containers`. Autoriza la clave interna **antes de obtener el Durable Object**, para evitar inicializaciones facturables por peticiones no autorizadas.
- `workers/buffalo-control-plane/original-ws-bridge-lab.mjs`: además del bearer externo del puente y clave del protocolo Buffalo, requiere `BUFFALO_ORIGIN_UPGRADE_TOKEN` separado; envía ese token **únicamente** al service binding `BUFFALO_ORIGIN`, nunca al cliente. El destino continúa siendo fijo y privado.
- `infra/buffalo-origin/origin-server.test.mjs`: prueba real Node + `ws`, con handler Buffalo auténtico, autenticación privada y bloqueo de procesos. CI ejecuta también las regresiones del puente.

## Identidad de commit, riesgos y límites

La fuente anterior `SOURCE_ATTESTED` corresponde al **commit** `66bee2d96ec71692608fc0829486c2dc130ab7a0`. El código de la nueva envoltura pertenece a un **commit posterior**. No se permite reutilizar silenciosamente la atestación histórica como prueba de la imagen nueva.

En el build se exige `BUFFALO_IMAGE_SOURCE_SHA` de 40 caracteres y se incrusta como valor de imagen `BUFFALO_IMAGE_SOURCE_SHA`; el wrapper exige que coincida con `BUFFALO_ORIGIN_COMMIT_SHA`. Es una **comprobación de consistencia interna, no una garantía criptográfica independiente del origen del build**. Antes de autorizar una conexión desplegada debe existir recibo del CI de imagen (checkout exacto, digest OCI, asociación con manifest/código originales y commit), y una atestación válida del caso fuente para ese commit. La variable no sustituye esos recibos.

Para un handshake real con D1 necesitamos también que la imagen y el puente utilicen el SHA del modelo `initial_model_sha256` del handoff original. En el laboratorio anterior ese SHA fue `57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39`. Una prueba con modelo sintético NO demuestra el enlace D1 real.

## Despliegue — NO EJECUTAR en este PR

Preparar en Cloudflare una aplicación Container nueva y separada del Worker de control productivo. El proyecto raíz no usa actualmente Wrangler; por tanto este PR **no crea ni ejecuta un archivo Wrangler ni hace provisioning**. El operador deberá validar con la CLI Cloudflare que la configuración resultante asocia `BuffaloHandshakeContainer` a una namespace Durable Object, scheduling policy `durable_object` y la imagen construida en el commit de CI.

La app Container requiere secretos independientes, provistos en Cloudflare sin pegarlos al chat:

- `BUFFALO_ORIGIN_UPGRADE_TOKEN`: secreto de servicio Worker→origen; solo va en el encabezado privado.
- `BUFFALO_ORIGIN_AUTH_KEY`: clave del protocolo WebSocket original Buffalo.
- `BUFFALO_ORIGIN_MODEL_SHA256`: digest exacto del modelo del handoff acreditado.
- `BUFFALO_ORIGIN_COMMIT_SHA`: commit exacto acreditado de la imagen.
- `BUFFALO_ORIGIN_MODE=HANDSHAKE_ONLY_NO_AGENT_PROCESS`: nunca cambiar a un modo generativo en este origen.

El código del Container ejecuta `enableInternet:false`; **no** desplegar Python, tokens de proveedores, Cloudflare Workers AI o software generativo en esta fase. El Worker `buffalo-original-ws-bridge-lab` actualmente desplegado sigue con URL **deshabilitada**, solo binding D1, sin secrets y **sin BUFFALO_ORIGIN**, por lo que nunca inicia conexiones a un Container por sí solo.

### Advertencia de costos

Cloudflare Containers es un producto de **cobro por uso**, además de los recursos Worker/Durable Object. Incluso una simple prueba de handshake puede iniciar un Container con costo por tiempo activo. Por ello, el primer `start()` y el despliegue facturable requieren aprobación específica del usuario una vez verificados imagen y configuración. Referencias oficiales: https://developers.cloudflare.com/containers/examples/websocket/ y https://developers.cloudflare.com/containers/platform/pricing/.

## Criterio del siguiente hito

1. PR de código con todas las pruebas de servidor original y puente en verde.
2. Validar el Container/Docker build en CI sin utilizar proveedores (futuro build bajo control de presupuesto).
3. Confirmar imagen OCI/commit fuente y todos los secretos/policies, con Container y Worker **sin URL pública**.
4. Solo entonces habilitar temporalmente Access y ejecutar **un único handshake real workerd → Container**, sin Merlin ni PySD.
5. Auditar evidencia D1, y apagar endpoint.
6. Después de esa comprobación evaluar una autorización separada para el **primer turno real** con el adaptador Cloudflare existente.

**No implementar todavía** persistencia, hibernación, interrupción/reanudación, colas, ejecución de agentes, PySD, ni cambios al Worker o D1 productivos.
