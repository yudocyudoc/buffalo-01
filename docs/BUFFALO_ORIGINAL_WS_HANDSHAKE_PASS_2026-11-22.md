# Buffalo Full · Etapa 3B-2: handshake original WebSocket validado, sin inferencia

**Fecha de corte:** 2026-11-22 UTC. **Veredicto:** PASS acotado para protocolo WebSocket original en Node/loopback. No hay proxy Cloudflare desplegado ni sesión de agente.

## Evidencia de CI y código
- PR de implementación [#41](https://github.com/yudocyudoc/buffalo-01/pull/41), integrado a `main` mediante squash `57f4842fd785a24eea8770bbc3924d9ce95dc232`.
- Run de CI: [44988389494](https://github.com/yudocyudoc/buffalo-01/actions/runs/44988389494). Jobs `control-plane-offline` y `full-handoff-source-snapshot`: `success`.
- El job `full-handoff-source-snapshot` ejecutó `node --test scripts/full-integration/original-websocket-handshake.test.mjs`: **1/1 PASS** y en logs imprimió `PASS real ORIGINAL Buffalo websocket session_created/session_ready/disconnect; agent turns=0; providers=0; prewarm mocked=1`.
- La suite previa de integración del orquestador original: **7/7 PASS**; la política de mensajes `original-ws-handshake-gate.test.mjs`: **5/5 PASS**.
- Archivos añadidos: `scripts/full-integration/original-ws-handshake-gate.mjs`, sus tests, `original-websocket-handshake.test.mjs` y `docs/BUFFALO_ORIGINAL_WEBSOCKET_HANDSHAKE_ETAPA3B2_2026-11-22.md`. No se editó `agent/WebSocket.js`, `agent/AgentWorker.js`, `agent/AgentOrchestrator.js` ni el adaptador Cloudflare preexistente.

## Flujo realmente observado
Se abrió un servidor `ws` real de Node en `127.0.0.1` con la ruta original `/api/v1`. El objeto `WebSocketHandler` original envió `session_created`; rechazó un `chat` prematuro con `SESSION_NOT_INITIALIZED`; recibió `initialize_session` autenticado; envió `session_ready`; finalmente aceptó `disconnect` y cerró la sesión. Se conservó el `SessionManager` original y se usó un cliente WebSocket real.

**Control de gasto del ensayo:** el `WorkerSpawner.spawn` se sustituyó *solo en memoria de esa prueba* por un error determinista, pues el handler original intenta precalentar un subproceso inmediatamente después de `initialize_session`, antes de `select_agent`. No se seleccionó Merlin ni se envió `chat` de ejecución; la política rechazó ambos antes de alcanzar el backend. No hubo solicitud a modelos, ejecución PySD ni evaluación.

## Hallazgo negativo recuperado
La primera ejecución de la prueba de handshake falló por `clientId is required` en `SessionManager.initializeSession()`; aunque el esquema de `initialize_session` lo declara opcional, su implementación exige un valor no vacío. El adaptador de prueba pasó a inyectar `clientId` del servidor junto con la autenticación de origen, rechazando valores aportados por el cliente. El segundo run pasó. Se conservaron ambos resultados en la cronología de GitHub y **no se modificó el código fuente de Buffalo**.

## Continuidad comprobada fuera de CI
Consultas directas a Cloudflare D1 tras el merge:

- Producción: tarea histórica `d3af46b3-01ce-4c28-ba24-31d52a908464` permanece `SUCCEEDED`, run `44956533083`, artifact `14728065888`.
- D1 experimental: handoff `6bce82ee-d179-4a2e-9317-f7f4708c5be2` permanece `REGISTERED_UNVERIFIED`, `execution_allowed=0`, `provenance_verified=0`.
- Su evidencia independiente sigue `SOURCE_ATTESTED`, run `44976002057`, `execution_allowed=0`.
- La tabla `buffalo_full_live_grants` contiene **0** registros.

## Lo que falta antes de afirmar «Buffalo funciona con Worker + D1»
El ensayo NO contiene un Cloudflare Worker actuando como proxy WebSocket hacia Node remoto, ni un Container real ejecutando Buffalo. Tampoco prueba autorización atómica de sesiones, aplicación de límites de inferencia por conexión, ni reconexión/reanudación. El próximo hito será un Worker **aislado** capaz de admitir solo una sesión de handshake contra un runtime Node privado, con frames bloqueados para `select_agent` y `chat` hasta implementar un grant real y presupuestos independientes.

La meta continúa siendo **Buffalo interactivo original primero; asíncrono e interrumpible después**.
