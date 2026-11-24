# Buffalo · Stage 3B-8 — protocolo de entrada al runtime original de Merlin (propuesta)

**Fecha:** 2026-11-23 (México). **Estado:** DISEÑO PARA REVISIÓN — no implementado, no autorizado para despliegue ni inferencia.  
**Base documental:** 3B-7 cerrado y fusionado en `main@c129c8011bd84ee48f50db2948ad24460158a6d8`.  
**Pregunta nueva:** ¿puede la ruta privada ya demostrada entregar una sesión al proceso original de Merlin y, posteriormente, bajo otra compuerta, producir un turno genuino, acotado y observable?

## 1. Evidencia anterior que NO debe repetirse ni reinterpretarse

1. **3A — frontera offline:** se construyeron `SessionManager`, `AgentConfigurationManager` y `AgentOrchestrator` originales, con sincronización de modelo. `startConversation()` rechazó un proveedor deliberadamente inexistente. Recibo `OFFLINE_BOUNDARY_PASS_NO_AGENT_OUTPUT`; no produjo turno.
2. **20 de noviembre — ejecución pagada diferente:** Merlin/Inkling 2 Small, escenario `policyImplementation/dialysisClinic`, produjo ocho respuestas HTTP 200, diez solicitudes de herramientas y ningún modelo/grade final adjudicable. El presupuesto de ocho POST se agotó. **Esa vía no fue el bridge privado 3B-7**. Herramienta solicitada o «completed» no implica éxito semántico.
3. **3B-7 — conexión privada auténtica:** `REAL_BRIDGE_HANDSHAKE_PASS` con `HTTP 101 → session_created → session_ready → disconnect → close`, recibo D1, nueve fases y restauración. No procesó `select_agent` ni `chat`, no arrancó un `AgentWorker` y no pidió inferencia. Conservar la diferencia entre snapshot agregado de Containers a las 22:53:48.596 UTC y registro `stopped` actualizado a las 22:54:33.204 UTC.

**No reiniciar** `one-shot-private-bridge-v1`, no borrar el claim durable ni los recibos, no reutilizar una aprobación o presupuesto anterior. Mantener 3B-7 como resultado cerrado.

## 2. Brecha de arquitectura comprobada en HEAD

- `infra/buffalo-origin/origin-server.mjs` declara `HANDSHAKE_ONLY_NO_AGENT_PROCESS`, niega `WorkerSpawner.spawn` y bloquea desde `SafeOriginalSocket` todo `select_agent` / `chat`. La imagen OCI actual comparte esa semántica. Cambiar un flag del Worker, por sí solo, **no ejecuta Merlin**.
- `scripts/full-integration/original-ws-handshake-gate.mjs` niega esos mismos frames. Conservarlo intacto para replays 3B-2/3B-7; cualquier política de turnos debe tener identidad y pruebas propias.
- El handler original `agent/WebSocket.js` intenta precalentar `WorkerSpawner.spawn` al aceptar `initialize_session`, **antes de `select_agent`**. La autorización para crear un proceso no puede colocarse únicamente en `chat`.
- El agente `agent/config/merlin.md` tiene `agent_mode: sdk`, `max_iterations: 50` y permisos de escritura local declarados. La política de un primer ensayo estrecho debe imponerse **fuera del prompt** y no alterar su configuración original inadvertidamente.
- `agent/WorkerSpawner.js` necesita una comprobación real de aislamiento `bwrap`; `ALLOW_UNSANDBOXED_FALLBACK=true` está prohibido para un Container con agente. La imagen 3B-7 se construyó para handshake, no acredita disponer de `bwrap`, Python/PySD o la ruta de proveedor.
- `workers/buffalo-control-plane/original-live-admission.mjs` hace **preflight read-only**; su resultado `ADMISSION_CONDITIONS_MET_RUNTIME_NOT_INVOKED` declara explícitamente `runtime_budget_enforcement_verified:false`. Ni un `SOURCE_ATTESTED` ni ese preflight consumen un grant o autorizan una llamada.

El diseño de la conexión del proveedor desde un Container con `enableInternet:false` está **sin demostrar**. No ampliar egress ni copiar el bootstrap de GitHub a producción por suponer compatibilidad.

## 3. Tres puertas independientes

### Puerta P — preparación offline en rama nueva (trabajo inmediato)

**Sin Cloudflare, proveedor, Container facturable, despliegue ni nuevos recibos D1.**

Entregar un adaptador versionado para **una sola sesión controlada** y ensayos negativos sobre el código original:

- El nuevo gate deja pasar la secuencia ordenada `initialize_session → select_agent(merlin) → chat` solo bajo identidad de sesión, commit, modelo y política fijados. Separa identidad de conexión, autorización de *spawn*, autorización de proveedor y presupuesto; no hereda el claim 3B-7.
- Denegar por defecto: `agentConfig` personalizado; cambio de agente/proveedor; segundo `chat`; historial, adjuntos, herramientas cliente arbitrarias, rutas públicas, URLs de origen elegidas por usuario, `tool_call_response` inyectado o frames fuera de orden.
- Ejecutar en CI el `WebSocketHandler`, `SessionManager`, `WorkerSpawner`, `AgentWorker` y la ruta de selección originales **hasta donde permitan el sandbox y las dependencias**, bajo denegación de proveedor y egress. Un mock que simula `agent_selected` o un stub de `spawn` **no sirve** para afirmar que el proceso arrancó.
- Guardar evento verificable de arranque y terminación del proceso, identidad de código, nombre de agente/config, respuesta nativa, error de proveedor negado, modelo antes/después, intentos de red y procesos. Clasificar ausencia de `bwrap` como `SANDBOX_NOT_AVAILABLE`, no como PASS.
- No usar un «Merlin» sustituto, un texto generado a mano ni un proveedor simulado como evidencia de respuesta del agente.

**Aceptación P:** ruta y tests disponibles en CI, gates negativos probados, y demostración explícita del alcance real; las pruebas que solo emulan sockets o Worker son `OFFLINE_LOGIC_ONLY`. No pasar a ejecución remota por un CI verde.

### Puerta R — prueba privada del proceso sin inferencia (futura, autorización separada)

Solo cuando P esté revisada:

1. Construir una **nueva imagen** con runtime apto para `AgentWorker`, sandbox efectivo y mecanismo de denegación de proveedor; publicar y verificar por digest remoto. Verificar commit fuente, configuración Merlin y hash del modelo original. No reutilizar digest ni atestación 3B-7.
2. Crear una sonda de proceso **nueva** con recibo y claim irrepetible propios. El Container sigue privado, una sola instancia, sin endpoints públicos y con límite temporal/restauración explícitos. El coste de Container debe autorizarse aunque no haya inferencia.
3. Acreditar la ruta `Bridge → RPC → Router → DO → Container → original WebSocketHandler → real AgentWorker`. Permitir `select_agent(merlin)` y una entrada `chat` al orquestador solo con proveedor no registrado, para producir el rechazo nativo esperado. Esto demuestra el *límite de proceso*, no una respuesta de Merlin.
4. Registrar proceso real y aislamiento, mensajes auténticos, `CONVERSATION_ERROR` por proveedor negado, cero solicitudes al proveedor corroboradas por el mecanismo de egress, ausencia de modificación del modelo, teardown del Worker y Container, estado posterior de grants, cron, bindings y origen. Distinguir métricas agregadas de historial por instancia como en 3B-7.

**Resultado legítimo:** `ORIGINAL_AGENT_PROCESS_BOUNDARY_PASS_NO_INFERENCE` (identificador propuesto, no API implementada). Si un proceso no arranca, cerrar con su causa: ni un error esperado fabricado desde el gateway ni un `agent_selected` del socket equivalen a haber arrancado `AgentWorker`.

### Puerta I — primer turno generativo genuino (futura, autorización de inferencia diferente)

Solo si R terminó con evidencia suficiente y se verificó la ruta de proveedor:

- **Pregunta acotada y de solo lectura:** solicitar a Merlin que enumere los stocks, flujos y ecuaciones principales **del modelo SFD inicial exacto**; no solicitar predicción, modificación, `run_model`, visualización o graders. El prompt se sella antes de inferir. Esta tarea no pretende validar el benchmark `policyImplementation`.
- Reutilizar el *Merlin original* y su modelo, pero imponer externamente una allowlist de una sesión, un `select_agent`, un `chat`, herramientas de lectura autorizadas y cero modificaciones. `get_current_model` debe retornar la copia **real** del modelo inicial y no una reparación; las solicitudes de herramientas no admitidas se rechazan y registran.
- El proveedor y modelo se identifican exactamente antes del despliegue. Elegir, documentar y autorizar límite de POST, consumo (`max_neurons` si verificablemente aplicable), tokens por solicitud y tiempo total. El conteo en el proceso **no basta** si existen rutas de proveedor o herramientas que lo evaden. El consumo medido tras una respuesta no puede garantizar por sí solo que esa misma respuesta no sobrepase el techo: declarar y diseñar esa exposición.
- El grant nuevo debe tener consentimiento, identidad de fuente/runtime, vencimiento y **claim atómico antes del primer recurso o POST relevante**; denegar replays y concurrencia. El preflight read-only actual no sustituye este claim. No se aprueba desde un commit, un prompt ni un recibo `SOURCE_ATTESTED`.
- Conservar mensajes nativos, tipo de herramienta, su `isError` cuando exista, cuenta de solicitudes aceptadas/rechazadas y usage real; distinguir contenido generado, terminación auténtica `agent_complete`, lectura del modelo y exactitud semántica contra el input. No considerar suficiente `agent_selected` ni el texto fijo de bienvenida del handler.
- Un fallo, timeout, corte de presupuesto, respuesta parcial o error de herramienta consume el intento según los recibos reales; no hacer reintentos automáticos ni transformar la segunda plaza en otra generación. Restablecer infraestructura y revocar el acceso.

**Cierre I:** `REAL_MERLIN_TURN_COMPLETED`, `PARTIAL_BUDGET_EXHAUSTED`, `PROVIDER_ERROR`, `RUNTIME_FAILURE` o `NOT_ADMISSIBLE` (estados propuestos; formalizar antes del run). No afirmar que se ejecutó PySD ni que Merlin resolvió una política por haber producido una respuesta descriptiva.

## 4. Pruebas negativas mínimas antes de cualquier live

1. `initialize_session` con modelo, commit, handoff o `clientId` ajenos; intento de pasar autenticación desde cliente.
2. `select_agent` sin autorización de proceso, identidad distinta de Merlin, `agentConfig` o proveedor distinto del fijado.
3. `chat` sin grant válido, antes de `session_ready`, duplicado, después de `disconnect` o desde otro `sessionId`.
4. Petición a proveedor sin claim, grant expirado, grant usado/revocado, concurrencia de dos sesiones y simulación de agotamiento del presupuesto; rechazo comprobado **antes** del POST.
5. Solicitud de escribir archivos, modificar modelo, ejecutar simulación, usar herramientas cliente no autorizadas o leer secretos; falla cerrada, no «se lo pedimos al prompt».
6. `bwrap` ausente/roto, falla de bootstrap, timeout, desconexión del cliente y cancelación de CI: no arrancar unsandboxed ni dejar procesos o infraestructura temporal.
7. Telemetría de instancia donde el contador agregado llega a cero antes del estado `stopped`: ambas observaciones deben conservarse sin deducir una hora física de apagado.

Las pruebas offline pueden demostrar decisiones de código, nunca ausencia real de egress, facturación o cierre de Containers desplegados.

## 5. Orden y coste: alcance de esta entrega

| Entrega | Qué produce | Proveedor | Container real |
| --- | --- | --- | --- |
| **3B-8/P** | Protocolo y, tras revisión, código/tests de preparación offline | 0 | 0 |
| **3B-8/R** | Evidencia de proceso Merlin privado, proveedor negado | 0 | Hasta 1, **solo con autorización propia** |
| **3B-8/I** | Un turno real de lectura con presupuesto y grant nuevos | Tope **por definir y aprobar** | Hasta 1, **solo con autorización propia** |

No construir una ruta que haga automáticamente R o I tras merge, PR, cron, tests o éxito anterior. Conservar `3B-7=CERRADO`, los dos Workers en configuración restaurada, cero cron y grants del ensayo anterior intactos. Una autorización de P **no** autoriza R ni I.

## 6. Fuentes consultadas de `main`

- [3B-7, cierre original](BUFFALO_STAGE3B7_CIERRE_EXPERIMENTAL_2026-11-23.md).
- [3A, frontera offline](BUFFALO_ORIGINAL_OFFLINE_BOUNDARY_PASS_2026-11-22.md).
- [Merlin + Inkling: ocho POST y diez herramientas](EJECUCION_MERLIN_INKLING_2026-11-20.md).
- [Origen privado handshake-only](../infra/buffalo-origin/origin-server.mjs).
- [Gate original de handshake](../scripts/full-integration/original-ws-handshake-gate.mjs).
- [WorkerSpawner original](../agent/WorkerSpawner.js) y [WebSocketHandler original](../agent/WebSocket.js).
- [Admission read-only](../workers/buffalo-control-plane/original-live-admission.mjs).

**Decisión de este PR:** fijar la pregunta y los bloqueos reales. No crear un segundo framework de agentes, no sustituir Merlin, no repetir la sonda 3B-7 y no habilitar ninguna llamada pagada.
