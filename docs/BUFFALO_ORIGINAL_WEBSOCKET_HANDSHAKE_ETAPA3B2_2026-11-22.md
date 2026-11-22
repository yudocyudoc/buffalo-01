# Buffalo Full · Etapa 3B-2 — handshake WebSocket original sin inferencia

**Corte:** 2026-11-21 CDMX / 2026-11-22 UTC.  
**Objetivo:** conservar el Buffalo interactivo sin alterar sus agentes ni convertirlo en una tarea batch. Prueba de contrato previa al proxy Worker + D1.

## Lo que hallamos en el código original

- `app.js` expone el WebSocket original en `/api/v1`, administrado por `agent/WebSocket.js`. No hay que inventar un protocolo nuevo para el frontend.
- `WebSocketHandler` envía `session_created` al abrir, exige `initialize_session` autenticada y responde `session_ready`.
- Una solicitud `chat` antes de `session_ready` debe producir `SESSION_NOT_INITIALIZED`.
- **Importante:** aceptar `initialize_session` hace que el servidor llame inmediatamente a `WorkerSpawner.spawn` para precalentar el proceso, **antes de `select_agent`**. Sin acceso controlado al runtime esto puede crear procesos. En la prueba se *sustituye exclusivamente el método spawn en memoria*, con error inofensivo: comprobamos que el servidor original intentó precalentar y que aun así completó el protocolo de sesión. No se modifica el archivo original.

## Ensayo reproducible

`scripts/full-integration/original-websocket-handshake.test.mjs` instancia:

- `WebSocketHandler` original de Buffalo;
- `SessionManager` original (temp dir descartable);
- servidor `ws` real en loopback `127.0.0.1` con ruta original `/api/v1`;
- cliente WebSocket real, con mensajes intercambiados a través de `OriginalHandshakeFrameGate`.

Flujo previsto:

```text
WebSocket original conectado → session_created
  ↓
chat prematuro → SESSION_NOT_INITIALIZED
  ↓
initialize_session (SD-JSON real; auth de origen inyectada en gate)
  ↓
WorkerSpawner.spawn invocado pero bloqueado por el fixture
  ↓
session_ready del WebSocket original
  ↓
select_agent y chat rechazados POR EL GATE (nunca llegan a Buffalo)
  ↓
disconnect → cierre limpio
```

`OriginalHandshakeFrameGate` es una **sonda local de política en Node**, todavía **no** el gateway de Cloudflare desplegado. Solo admite `initialize_session` con modelo exacto por SHA, sin historial, sin herramientas, sin adjuntos ni configuración personalizada. El gate no guarda el secreto de origen en un artefacto y no acepta que el usuario lo envíe. Rechaza mensajes fuera de orden y `select_agent`/`chat` deliberadamente. No se conoce ni se usa un grant `APPROVED` real.

No hay Cloudflare API, Workers AI ni tareas pagadas. No se usa la credencial `GITHUB_SOURCE_READ_TOKEN`. La suite corre en GitHub Actions sin secretos de inferencia y usa un cliente local `ws`.

## Alcance exacto del PASS

**Se demostrará** que la conexión WebSocket y el handshake del **handler auténtico** funcionan en Node, que el gate no permite llegar al ciclo del modelo y que los recursos temporales se cierran. Esto no equivale a una sesión gestionada end-to-end por Cloudflare Worker.

**NO se demuestra** conexión WebSocket de Worker a un servicio Node remoto, la aplicación de un grant consumible en una conexión real, la ejecución de `AgentWorker` o `AgentOrchestrator` bajo el WebSocket original, cumplimiento en producción del presupuesto por sesión, inferencia de Merlin, PySD, ni continuidad al desconectar.

## Siguiente compuerta concreta

1. Elegir/poner a disposición un runtime Node con `app.js` original en entorno aislado, con conectividad privada al Worker, Python/PySD y sandbox de procesos. Un Cloudflare Container requiere validar factibilidad y costos antes de desplegar.
2. Implementar en Worker el upgrade WebSocket autenticado y su unión al origen **sin permitir destinos seleccionados por el usuario**. Comprobar identidad del commit de runtime y política exacta.
3. El gateway revisará cada frame; la versión offline admitirá sólo `initialize_session` y `disconnect`. La versión que permita `select_agent` o `chat` tendrá que consumir atómicamente un grant con consentimiento válido, limitar la inferencia por sesión y demostrar que ninguna ruta alternativa evade el presupuesto.
4. Conectar el cliente real y medir `session_created` → `session_ready` a través del Worker, primero **sin inferencia**.
5. Solo después, con consentimiento y límites comprobados, completar una conversación y registrar su evidencia en D1.

**No iniciar en esta etapa** interrupción/reanudación persistente, cambio de los agentes, migración del benchmark a una aplicación batch, ni cambios en Cloudflare producción. La D1 de laboratorio mantiene `buffalo_full_live_grants` con 0 autorizaciones.
