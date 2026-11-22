# Buffalo original · Recibo 3B-4: Node privado preparado, probado y sin Container activado

**Corte:** 2026-11-22 UTC. **Veredicto:** `PRIVATE_ORIGINAL_NODE_ORIGIN_CI_PASS_NO_CONTAINER_DEPLOY`.

## Evidencia de código y CI

- PR #45 integrado mediante squash SHA `b7e600715d968955ddb160f63fce06a5dc2b6966`.
- GitHub Actions run [44991371205](https://github.com/yudocyudoc/buffalo-01/actions/runs/44991371205), jobs `control-plane-offline` y `full-handoff-source-snapshot` concluidos en **success**.
- El segundo job ejecutó `node --test infra/buffalo-origin/origin-server.test.mjs`: **4 tests aprobados, 0 fallos**. Instanció `WebSocketHandler` + `SessionManager` originales, con Node `ws` real y autenticación de upgrade: recibió `session_created` y `session_ready`. La selección de Merlin fue rechazada con WebSocket close 1008 y el contador de intentos de prewarm fue **1 bloqueado** por el propio proceso de origen: `BUFFALO_PRIVATE_ORIGIN_AGENT_SPAWN_DENIED`.
- Las pruebas previas del puente Worker y del WebSocket original siguieron aprobadas (**7/7**, **1/1**).
- El job `control-plane-offline` aprobó las pruebas negativas del bridge con **clave interna de origen independiente**. Sin inferencia, sin PySD, sin grader, sin llamada de modelos.
- Tests incluyen denegación de upgrades sin secreto, clave errónea, ruta distinta, chat directo y modelo/historial/herramientas no autorizados.

## Cambios y límites

- `infra/buffalo-origin/origin-server.mjs`: Node real con `WebSocketHandler` y `SessionManager` originales sin cambiar `agent/`; wrapper `SafeOriginalSocket` solo para modo handshake; el origen bloquea `WorkerSpawner.spawn` **en memoria** antes de aceptar sesiones.
- `infra/buffalo-origin/container-controller.mjs`: preparación de Worker+Durable Object con API **vigente** `ctx.container.start()`, `getTcpPort().fetch()`, `enableInternet:false` y token interno validado antes de asignar instancia.
- `infra/buffalo-origin/Dockerfile` + `.dockerignore`: empaquetado de Node 22 con exclusión de secretos, instalación sin hooks y usuario no privilegiado; requiere un argumento de compilación `BUFFALO_IMAGE_SOURCE_SHA`. **No se hizo todavía un build Docker ni una atestación OCI**; el Dockerfile sigue sin validación de imagen compilada.
- `original-ws-bridge-lab.mjs`: exige y manda `BUFFALO_ORIGIN_UPGRADE_TOKEN` únicamente al servicio interno, no al navegador; mantiene D1/handshake, sin permitir chat.
- **Identidad:** la fuente histórica `SOURCE_ATTESTED` corresponde al commit `66bee2d96ec71692608fc0829486c2dc130ab7a0`, que no es el commit nuevo del wrapper. La comparación del SHA incorporado en la imagen **no reemplaza** una atestación externa. No reutilizar el recibo histórico para autorizar una imagen nueva.

## Verificación independiente de Cloudflare después del merge

Cloudflare API confirmó:

- Worker `buffalo-original-ws-bridge-lab`: único binding D1 experimental `d1e23807-b076-4c36-8785-7b423fc41614`, `workers.dev.enabled=false`, previews desactivadas, cero cron, **cero secretos**.
- La búsqueda en aplicaciones Cloudflare Containers del account no devolvió ninguna aplicación identificada como Buffalo. **No se desplegó ni arrancó un Container** en esta etapa.
- D1 experimental: `buffalo_full_live_grants` contiene **0** autorizaciones.
- D1 experimental: handoff original `6bce82ee-d179-4a2e-9317-f7f4708c5be2` continúa `REGISTERED_UNVERIFIED`, `execution_allowed=0`, `provenance_verified=0`.
- Su atestación separada continúa `SOURCE_ATTESTED`, run `44976002057`, `execution_allowed=0`.
- D1 productiva: la tarea histórica `d3af46b3-01ce-4c28-ba24-31d52a908464` continúa en `SUCCEEDED`, run `44956533083`, artifact `14728065888`.

## Próximos gates antes de una conexión real dentro de Cloudflare

1. Construir y revisar la imagen Linux/Node por CI, fijando digest OCI e identidad del checkout; corregir cualquier dependencia que el contenedor necesite. Evitar la falsa equivalencia entre variable `commit_sha` y procedencia atestada.
2. Crear atestación de fuente actualizada para la imagen/origen que realmente se vaya a desplegar; no reutilizar una prueba anterior.
3. Confirmar costo y autorización explícita para Container **antes** de ejecutar `ctx.container.start()`; Cloudflare factura tiempo de instancia, además de Worker/Durable Object.
4. Configurar el Worker/DO Container **sin ruta pública**, provisionar secretos separados en el dashboard, verificar origen y D1, y conectar `BUFFALO_ORIGIN` al bridge experimental.
5. Solo entonces realizar una prueba de handshake con un cliente WebSocket real atravesando **workerd → Container** y guardar evidencia de integración. Esta prueba seguirá sin modelos ni agentes.
6. El posterior primer turno real de Merlin exigirá consentimiento independiente, límites de gasto por sesión y verificación de herramienta/simulación; **no** implementar aún asincronía persistente, pausas ni reanudación.

Referencia de Containers/WebSocket actual: https://developers.cloudflare.com/containers/examples/websocket/ y https://developers.cloudflare.com/containers/platform/pricing/ .

**Resultado epistemológico:** El origen Node genuino está validado mediante CI; el origen Container y la conexión Cloudflare real aún no están demostrados.
