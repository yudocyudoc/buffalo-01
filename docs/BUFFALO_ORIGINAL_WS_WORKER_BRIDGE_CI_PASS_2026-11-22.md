# Buffalo Full · Etapa 3B-3: puente Worker ↔ WebSocket original, CI PASS y despliegue cerrado

**Corte:** 2026-11-22 UTC.

## Identidad del cambio

- PR #43 [integrado](https://github.com/yudocyudoc/buffalo-01/pull/43), squash commit `8af307d7bce6e154dcda1be6625fd4c21530513d`.
- Código: `workers/buffalo-control-plane/original-ws-bridge-lab.mjs`.
- Política original reutilizada: `scripts/full-integration/original-ws-handshake-gate.mjs`.
- Prueba de circuito: `scripts/full-integration/original-worker-ws-bridge.test.mjs`; pruebas negativas `workers/buffalo-control-plane/original-ws-bridge-lab.test.mjs`.
- CI GitHub run [44990686009](https://github.com/yudocyudoc/buffalo-01/actions/runs/44990686009); jobs `control-plane-offline` y `full-handoff-source-snapshot` ambos `success`. El segundo generó el mensaje `PASS Worker bridge function + ORIGINAL Buffalo WS + D1 proof; no AI; prewarm stub=1`.
- También concluyeron con éxito los checks `Buffalo control-plane contract (offline)` y `Go`. El job agregado `Run Unit Tests` todavía estaba `in_progress` en la última consulta, y **no se afirma que ya haya pasado**.

## Qué se ejecutó realmente en CI

El handler del Worker se invocó **en Node**, utilizando un `WebSocketPair` y un service binding **emulados en la prueba**, pero con el `WebSocketHandler` y `SessionManager` originales levantados en un servidor real `ws://127.0.0.1:<puerto>/api/v1`. El gateway:

1. Rechazó upgrades sin bearer, URLs con query params, peticiones sin WebSocket y subprotocolos inesperados.
2. Consultó una D1 simulada mediante `SELECT`: handoff fijo Merlin, modo SFD, commit y `SOURCE_ATTESTED`; no escribe grants ni declara una sesión ejecutable.
3. Usó exclusivamente `BUFFALO_ORIGIN.fetch` con Request fijo `https://buffalo-internal.invalid/api/v1`, sin pasar autorización del navegador al origen.
4. Recibió `session_created`, envió `initialize_session` con `clientId` y clave de origen inyectados y recibió `session_ready` desde el handler auténtico.
5. Rechazó `chat` en el gate: la conexión terminó sin crear turno de agente.
6. El handler original **sí intentó** `WorkerSpawner.spawn` en su prewarm previsto; solamente en la prueba se reemplazó ese método por un error controlado. No se ejecutó ningún proceso de agente, modelo de IA, PySD ni grader.

**Alcance honesto:** el circuito del Worker no se probó todavía dentro de `workerd` ni contra un Container real. Las interfaces `WebSocketPair` y `BUFFALO_ORIGIN` fueron adaptadas en Node para CI. Esto prueba la lógica y el enlace al protocolo Buffalo, **no** la conectividad de Cloudflare desplegada.

## Evidencia Cloudflare de despliegue aislado

Se publicó `buffalo-original-ws-bridge-lab` con `compatibility_date=2026-11-21` y **único binding D1** hacia `d1e23807-b076-4c36-8785-7b423fc41614`, sin ninguna de las variables o secretos obligatorios para enlazar un origen. Los endpoints no están disponibles públicamente:

- `subdomain.enabled=false`
- `previews_enabled=false`
- `schedules=[]`
- `secrets=[]`
- **NO existe binding `BUFFALO_ORIGIN`**; tampoco `BUFFALO_WS_LAB_BEARER` ni `BUFFALO_ORIGIN_AUTH_KEY`. Por diseño el bridge se niega a iniciar.

La fecha de compatibilidad de Workers es posterior a la habilitación por defecto de Node.js compatibility (2026-08-04), que incluye `node:crypto` para la política de SHA-256. Documentación: https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/.

## Continuidad y prohibición de inferencia

Consulta independiente a D1 experimental: handoff `6bce82ee-d179-4a2e-9317-f7f4708c5be2` sigue `REGISTERED_UNVERIFIED` y `execution_allowed=0`. La prueba independiente sigue `SOURCE_ATTESTED`, run GitHub `44976002057`, `execution_allowed=0`. `buffalo_full_live_grants` sigue con **0 registros**.

Consulta a D1 productiva: tarea histórica `d3af46b3-01ce-4c28-ba24-31d52a908464` sigue `SUCCEEDED`, run `44956533083`, artifact `14728065888`. No se modificó Worker ni D1 productivos.

## Próxima compuerta

No introducir aún concurrencia asíncrona, interrupciones, persistencia de sesiones ni aprobaciones de IA. Antes del primer `101` real en Cloudflare:

1. Definir un **origen privado Node/Linux** para el servidor Buffalo original `/api/v1`. No usar URL pública abierta.
2. Deshabilitar por un mecanismo verificable del *origen* el prewarm de `WorkerSpawner.spawn` en modo handshake: la variable de configuración del Worker no basta para impedir ese proceso en Node. Preferir un wrapper/adaptador externo y no modificar el Buffalo original.
3. Pinar identidad del commit de origen y confirmar el modelo inicial de D1. Preparar claves de origen y bearer exclusivamente en Cloudflare, sin compartirlas en chat.
4. Conectar `BUFFALO_ORIGIN` mediante binding privado, habilitar temporalmente Cloudflare Access y demostrar handshake con un cliente WebSocket real atravesando `workerd`; verificar cierre y privacidad.
5. Solo entonces discutir un primer turno real, con autorización explícita por sesión y presupuesto del adaptador Cloudflare existente.

**Veredicto actual:** `BRIDGE_CI_PASS_NO_DEPLOYED_ORIGIN_NO_AI`. No escribir `SOURCE_ATTESTED` adicional ni declarar ejecución exitosa del agente.
