# Buffalo Full · Primera integración interactiva Worker + D1 (etapa 3B-1)

**Fecha de trabajo:** 2026-11-21 México / 2026-11-22 UTC.  
**Estado:** gateway de *admisión en lectura* preparado; ejecución interactiva real **NO iniciada**.  
**Objetivo:** hacer funcionar primero el Buffalo original **en sesiones vivas**, con Worker + D1 gobernando el acceso. *Asincronía persistente, interrupción y reanudación quedan para una fase posterior.*

## Hallazgo central en el código original

Buffalo **ya tiene** un servidor interactivo WebSocket propio:

- `agent/WebSocket.js`: `initialize_session`, `select_agent`, `chat`, `tool_call_response`, `model_updated_notification`, `stop_iteration` y `disconnect`. El servidor envía `session_created`, `session_ready`, `agent_complete` y mensajes de herramientas.
- `agent/WorkerSpawner.js` y `agent/AgentWorker.js`: cada sesión corre en un proceso Node; en Linux intenta aislarlo con bwrap; el modelo en uso y el contexto residen mientras la sesión está viva.
- `agent/README.md`: **el cliente original es propietario del modelo y del historial completo**, no la base de datos del servidor.
- `agent/AgentOrchestrator.js`: los proveedores OpenAI-compatible ejecutan su loop manual aunque el frontmatter original marque `agent_mode: sdk`; **no debemos modificar Merlin ni su MD** para activar Cloudflare.
- `scripts/cloudflare/bootstrap.mjs`: adaptación **preexistente** a Workers AI para turnos originales OpenAI-compatible, herramientas vía SDK OpenRouter y adaptador IGC, con presupuestos/neuronas y fallos acotados. No reconstruir esta pieza.
- `scripts/run-one-native-agent-case.mjs`: ejecuta un **benchmark de un solo caso**, no una sesión interactiva WebSocket; no usar este ejecutor como sustituto de la experiencia original.

## Arquitectura inmediata y futuro separado

**Ahora (sesión interactiva original):**

```text
Cliente WebSocket original (dueño del modelo)
  ↕  (initialize_session, select_agent, chat, tools, stop)
Worker Cloudflare (Access/autorización y política)
  ↕ verifica admisión
D1 (identidades, grants explícitos, recibos; NO guardar toda la conversación todavía)
  ↕
Node/Linux Buffalo original (WebSocket.js + AgentWorker.js)
  ↕  bootstrap Cloudflare ya existente (no editar agentes)
Cloudflare Workers AI (solo con permiso separado + límites por sesión)
```

El Node/Linux puede vivir inicialmente en un servicio aislado, potencialmente un Cloudflare Container; un Container no equivale a un Worker convencional y su costo/aislamiento y compatibilidad con bwrap y PySD se deben comprobar antes de desplegar. El gateway no debe exponer un puerto del origen ni inyectar identificadores del cliente como URL de destino.

**Después, otra fase:** persistencia de checkpoint, cola de espera humana, reanudación desde D1/R2. No introducir hoy Durable Objects, Queues, Workflows ni una reescritura de estados conversacionales por anticipado.

## Contrato implementado en 3B-1

1. `0005_full_live_grants_lab.sql`: una tabla de autorizaciones `buffalo_full_live_grants` **separada** de los handoffs y de la prueba `SOURCE_ATTESTED`. Todo nuevo grant nace `PENDING` sin consentimiento ni presupuesto; pasar a `APPROVED` requiere evidencias no nulas (actor, recibo, tiempos y límites) y se valida mediante CHECK en SQLite. **No existe un endpoint que emita aprobaciones** en este cambio.
2. `original-live-admission.mjs`: `OriginalLiveAdmission.preflight(grant_id)` hace solamente **SELECT**, vincula grant, handoff original y atestación independiente; exige identidad de Merlin u otro agente original, proveedor `cloudflare`, `sfd`, mismo commit y manifiesto; exige consentimiento separado, presupuesto, fecha vigente, ausencia de revocación/uso y pin del commit de runtime. No abre WebSocket, no llama IA, no despacha GitHub.
3. `GET /v1/full/live/grants/{grant_id}/preflight`: usa autenticación bearer existente del Worker; `POST` rechazado. El éxito de lectura se llama `ADMISSION_CONDITIONS_MET_RUNTIME_NOT_INVOKED`, y declara explícitamente `execution_started=false`, `websocket_connected=false` y `runtime_budget_enforcement_verified=false`.
4. Tests de política y migración: ausencia de grant a pesar de `SOURCE_ATTESTED`, pendiente sin consentimiento, identidad/commit incorrectos, expiración/revocación/consumo, límite ausente, runtime no pineado, autorización HTTP y **cero escrituras D1**.

Este cambio **no habilita un producto ejecutable**. No aplicamos la migración a la D1 productiva ni creamos grants. La atestación histórica del handoff `6bce82ee-d179-4a2e-9317-f7f4708c5be2` permanece no ejecutable por sí sola.

## Restricciones adicionales descubiertas para el proxy real

El cliente original puede enviar `select_agent.agentConfig` (configuración personalizada), `initialize_session.historicalMessages` (la limpieza del contexto podría llamar a otro proveedor antes de elegir agente), herramientas del cliente arbitrarias o `add_file` (embeddings). **Un proxy WebSocket ciego no basta**: podría permitir llamadas no presupuestadas o comportamientos que el Control Plane no autorizó.

Antes de habilitar una sola conexión pagada se deben probar:

- **Autorización real:** emisión de grants por un flujo autenticado con consentimiento trazable; nunca mediante un `SOURCE_ATTESTED` ni inserción administrativa no verificada.
- **Control de protocolo:** solo `agentId` preaprobado, sin `agentConfig` arbitrario; provider efectivo = Cloudflare; restricciones de `historicalMessages`, `tools`, adjuntos, y mensajes de herramientas según capacidades permitidas. Preservar el formato de WebSocket original.
- **Ejecutor:** Node Buffalo real con `bootstrap.mjs` precargado. La misma identidad de commit/imagen debe alcanzarse por el Worker; verificar compatibilidad de Node, Python, PySD, bwrap y el protocolo `session_created` → `agent_complete`.
- **Presupuesto por sesión:** `BUFFALO_CF_MAX_POSTS` y `BUFFALO_CF_MAX_NEURONS` deben asignarse y exigirse por grant, no como límites compartidos implícitos entre varios clientes. Presupuestos estimados no equivalen a facturación garantizada.
- **Aislamiento:** impedir proveedores no autorizados y consultas externas no cubiertas por el adaptador. No habilitar el nuevo enlace sin controles de egress/secretos.
- **Prueba remota de sesión:** cliente → Worker → Node/AgentWorker → respuesta al cliente. Primero handshake sin inferencia; luego una prueba original y pagada **solo con autorización separada y presupuesto**. D1 registra el ciclo, no declara éxito por un mero HTTP 101.

## Lo que no cambia

Ningún archivo de `agent/`, los prompts originales, PySD ni el adaptador preexistente Cloudflare. No se activa el workflow `paid-agent-case.yml`. No se reescriben las tablas productivas o las atestaciones anteriores. No hay suspensión/reanudación persistente.

**Criterio para llamar “Buffalo original funciona con Worker + D1”:** un cliente real conversa con Merlin mediante el WebSocket original, la sesión se mantiene activa, el modelo/las herramientas responden correctamente, el Worker admite con consentimiento/budget propio y D1 contiene un recibo verificable de esa ejecución, sin que GitHub Actions sea el motor de conversación.
