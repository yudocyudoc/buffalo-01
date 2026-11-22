# Buffalo Full · Etapa 3B-3 — puente WebSocket Worker ↔ Buffalo original (laboratorio)

**Fecha de diseño:** 2026-11-22 UTC.  
**Estado:** implementación y tests en PR; un Worker desplegado sin origen configurado **debe devolver 503**. No es todavía un producto ejecutable.

## Objetivo inmediato

Poner al **Worker+D1 delante del protocolo original** de Buffalo, preservando las clases `WebSocketHandler`, `SessionManager`, el puerto/ruta `/api/v1` y el adaptador de Cloudflare AI. En esta fase **solo handshake**, no selección de Merlin, chat, PySD, herramientas, inferencia ni aprobación de gasto. No introducir todavía pausas/reanudación, Durable Objects o estados nuevos de tarea.

## Topología de la prueba CI

```text
Cliente WebSocket (par de sockets de prueba)
  ↕
original-ws-bridge-lab.mjs (handler de Worker en Node, con sockets adaptadores)
  ├─ token exclusivo para laboratorio (prueba)
  ├─ SELECT D1 simulado, identidad del handoff y SOURCE_ATTESTED
  ├─ puerto origen no seleccionable por cliente: binding BUFFALO_ORIGIN.fetch()
  └─ OriginalHandshakeFrameGate de 3B-2 SIN cambios
  ↕
Servidor real Node ws de loopback /api/v1
  ↕
WebSocketHandler + SessionManager originales
  └─ WorkerSpawner.spawn negado por sustitución en memoria únicamente en CI
```

**Límite epistemológico:** esto prueba la lógica del **módulo Worker** contra el WebSocket auténtico de Buffalo, pero el circuito de prueba usa un sustituto de `WebSocketPair` y un adaptador de service binding. **No prueba aún workerd/Cloudflare Worker → Container real.** El entorno aislado de Cloudflare requiere un origen privado (Container o servicio Workers que exponga el Container) y su configuración todavía no existe.

## Control de acceso y confinamiento

- `GET /v1/lab/original-ws` es la única ruta. Requiere `Upgrade: websocket`, bearer de laboratorio de al menos 32 caracteres, sin query parameters ni subprotocolos arbitrarios. Endpoint de lab, **no** API pública de producción.
- Requiere `env.BUFFALO_ORIGIN` como **service binding** (no URL enviada por cliente), `env.BUFFALO_ORIGIN_AUTH_KEY` como secreto del servidor, `env.BUFFALO_RUNTIME_COMMIT_SHA` y `BUFFALO_WS_LAB_MODE=HANDSHAKE_ONLY_NO_AGENT_PROCESS`. La última cadena **no demuestra** por sí sola la seguridad del origen: el origen debe bloquear de verdad el proceso de agente, como hace el fixture.
- Antes de conectar, `SELECT` D1 verifica para el handoff real `6bce82ee-d179-4a2e-9317-f7f4708c5be2`: `SOURCE_ATTESTED`, Merlin, SFD, mismo commit en declaración/atestación/runtime y SHA-256 del modelo inicial. No escribe aprobación ni claim, no usa `buffalo_full_live_grants` porque **no permite inferencia**.
- El enlace origen usa exclusivamente `https://buffalo-internal.invalid/api/v1` mediante `BUFFALO_ORIGIN.fetch`; el nombre en Request es sintético, el binding resuelve el destino internamente. No remite el bearer del cliente ni permite SSRF.
- El gate `OriginalHandshakeFrameGate` acepta solo `session_created`, `initialize_session` con el modelo cuyo hash coincide, `session_ready`, errores originales y `disconnect`. Inyecta la clave origen y `clientId` controlados desde el Worker. **Todos** los `select_agent`, `chat`, `tool_call_response`, archivos, cambios de modelo y ajustes de inteligencia se rechazan con cierre (1008).
- Usa `WebSocketPair` y WebSockets por `fetch` con `accept({allowHalfOpen:true})`; cierre acoplado de los dos extremos. Documentación: https://developers.cloudflare.com/workers/runtime-apis/websockets/ .
- Sin URL de `workers.dev` pública activa ni runtime origen preconfigurado. El módulo se debe desplegar por separado del control plane productivo.

## Pruebas necesarias antes de conectar un origen real

1. Suite negativa: sin bearer, upgrades incorrectos, query arbitrario, subprotocolos, binding ausente, fuente no acreditada, commit equivocado y origen indisponible.
2. Integración CI: ruta del módulo Worker → service binding de prueba → servidor WebSocket **original** en loopback. Debe recibir `session_created`, `session_ready` y rechazar `chat`; el servidor debe intentar precalentar exactamente una vez, bloqueado por fixture. Ninguna inferencia.
3. Desplegar Worker de lab sin subdominio público y **sin BUFFALO_ORIGIN**. Consultas de D1 real son de solo lectura; ninguna concesión de ejecución.
4. Para el siguiente hito: preparar origen Node/Linux auténtico aislado que deshabilite `WorkerSpawner.spawn` en modo handshake, validar su identidad binaria/commit, conectar binding privado y demostrar handshake desde un cliente real pasando por **workerd**, todavía sin pago.
5. Separadamente, tras autorización expresa y un contrato de presupuesto por sesión, permitir selección de agente/chat y medir un turno real Cloudflare AI. **No usar SOURCE_ATTESTED como autorización.**

## Fuera de alcance

No se ha demostrado el Container real, el aislamiento Linux/bwrap, recepción del modelo de un cliente externo real a través de Cloudflare desplegado, las garantías de presupuesto por sesión, ni la recuperación tras desconexión. No confundir un PASS de CI del puente con autorización ni con éxito de Merlin.
