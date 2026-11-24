# Buffalo · Stage 3B-8/P — cierre de preparación del proceso original de Merlin (offline)

**Fecha del ensayo:** 2026-11-24 UTC (23 de noviembre en México).  
**Estado:** **3B-8/P, PASS offline con límites**. **NO** demuestra ejecución privada de Merlin por Cloudflare, modelo generativo ni inferencia. **NO** autoriza 3B-8/R ni 3B-8/I.

## 1. Pregunta y resultado

**Pregunta acotada:** ¿puede el código original Buffalo crear un `AgentWorker` de Merlin dentro de `bubblewrap` en un runner Linux, comunicarse por IPC, probar el rechazo nativo de un proveedor inexistente y cerrar los recursos? ¿Puede además el `WebSocketHandler` original iniciar, seleccionar a Merlin y terminar con el mismo proceso real sin enviar un turno generativo?

**Respuesta observada:** **Sí, en CI Linux offline del PR #66.** Se obtuvieron dos comprobaciones positivas independientes dentro del mismo workflow:

1. `ORIGINAL_MERLIN_WORKER_OFFLINE_PROVIDER_DENIED_PASS`: `WorkerSpawner` original → `AgentWorker` original en `IpcWorker`/bwrap, `AgentOrchestrator` original, entrada a `startConversation()` y `CONVERSATION_ERROR` genuino por `buffalo_stage3_provider_denied`, con `agent_complete=awaiting_user`, modelo inicial no modificado y proceso finalizado. El **rechazo** es el resultado esperado, no una respuesta de Merlin.
2. `ORIGINAL_MERLIN_WS_PROCESS_OFFLINE_PASS`: WebSocket local real → `WebSocketHandler` original → prewarm original `WorkerSpawner.spawn` → `AgentWorker` original, `session_created`, `session_ready`, `agent_selected`, barrera IPC con `get_context` y `disconnect`/cierre; un proceso, verificado y terminado. El gate offline **rechaza chat, edición, simulación y respuestas de herramientas**. `agent_selected` y el texto fijo de bienvenida son del handler, no una respuesta del agente.

La política 3B-8/P es nueva, versionada y **offline**. No altera el gate 3B-7, los archivos de Merlin, ni el origen privado desplegado previamente.

## 2. Evidencia de GitHub

- **PR:** [#66](https://github.com/yudocyudoc/buffalo-01/pull/66), Draft y no fusionado al registrar este cierre.
- **Run del protocolo 3B-8/P:** [45299737923](https://github.com/yudocyudoc/buffalo-01/actions/runs/45299737923), `pure-contract=success` y `original-worker=success`.
- **Job de proceso:** [138129154462](https://github.com/yudocyudoc/buffalo-01/actions/runs/45299737923/job/138129154462). Los logs registran `PASS ORIGINAL AGENTWORKER SANDBOXED OFFLINE, NO INFERENCE; NOT A BRIDGE RUN` y `PASS ORIGINAL WS / MERLIN WORKER REAL PROCESS; NO CHAT OR INFERENCE`.
- **Pruebas negativas puras:** ocho tests, cero fallos, en el gate 3B-8/P; cuatro tests, cero fallos, para admisión de entorno/WorkerSpawner.
- **Artefacto CI:** [buffalo-stage3b8-offline-45299737923](https://github.com/yudocyudoc/buffalo-01/actions/runs/45299737923/artifacts/14878656189), ID 14878656189, dos recibos JSON, ZIP SHA-256 `0828c19785bbcc8a47a658af4b13f461f5986360e6a21a76d0aec430dfe2c619`. El workflow escribió y comprobó ambos JSON antes de subirlos; se corroboró registro y digest del artifact con GitHub, **no se declara inspección independiente posterior de los bytes descargados**.
- **Identidad de código:** PR HEAD `f826cfa2b851656b31ca27510f837ffb713b4076` integrado por GitHub en checkout CI **sintético de PR** `158411110c07c8079c9b4c4a52dafb52a52a595b`, sobre `main@c129c8011bd84ee48f50db2948ad24460158a6d8`. Los recibos reportan `GITHUB_SHA`, correspondiente al checkout de prueba, **no al SHA del head de la rama**.

## 3. Hallazgos de compatibilidad corregidos durante la implementación

- El `SessionManager` original genera `sess_` + 32 caracteres hexadecimales; el primer gate exigió UUID y causó un timeout. Se corrigió **en el adaptador nuevo**, sin modificar Buffalo, con prueba correspondiente.
- El `select_agent` del WebSocket original valida `provider` contra `config.agentProviders`; `cloudflare` no es una opción registrada hoy. En la prueba **sin chat** se selecciona `anthropic` (identificador original aceptado), sin credencial ni llamada. La sonda directa conserva el proveedor **inexistente**, que provoca el rechazo nativo esperado. Esto **no** valida Cloudflare como proveedor en el WebSocket original ni autoriza añadirlo silenciosamente.
- Un envío de código a GitHub recibió por error texto de una referencia de archivo temporal caducada. Se reparó inmediatamente, se verificó que la fuente completa quedó disponible en la rama, y el run positivo citado es **posterior a la restauración**, no el CI anterior fallido.
- Los runs intermedios fallidos quedan en GitHub y no se ocultan: fueron defectos de esta implementación de prueba, **no evidencias de incapacidad general del motor Buffalo**.

## 4. Qué se demostró y qué no

| Categoría | Evidencia / límite |
| --- | --- |
| **Demostrado** | `WorkerSpawner` original crea y termina `AgentWorker` real en `bwrap` dentro de CI Linux; IPC funciona. |
| **Demostrado** | `AgentOrchestrator.startConversation` original rechaza un proveedor inexistente y finaliza con el error previsto, sin producir modelo. |
| **Demostrado** | WebSocket original puede inicializar y seleccionar a Merlin con proceso real; gate 3B-8/P impide chat. |
| **Demostrado como código de prueba** | Rechazos de frames no autorizados, falta de autorización local antes del prewarm y condiciones ambientales no admitidas. |
| **No medido independientemente** | Tráfico de salida real del sistema/proveedor; los recibos declaran `provider_requests_measured=false`. |
| **No demostrado** | Misma ruta en Cloudflare Container, aislamiento bwrap dentro de esa imagen, conectividad de proveedor del Container, grant atómico o presupuesto de inferencia end-to-end. |
| **No ejecutado** | Respuesta generativa real de Merlin; herramientas de modelado, PySD, grader o modelo nuevo en 3B-8/P. |

## 5. Continuidad y decisiones

**3B-8/P se cierra exclusivamente como preparación offline.** A la fecha de estos resultados no se desplegaron nuevos Containers/Workers, no se modificó D1 ni grants, no se realizó un POST de inferencia y no se reabrió 3B-7. Esa ausencia de acciones corresponde al alcance del workflow y su código; no constituye auditoría de todo el egress ni de facturación de Cloudflare.

**3B-8/R requiere una autorización distinta**, una imagen privada nueva con `bubblewrap` efectivo, identidad de imagen/commit/entrada, claim y recibos propios, un coste de Container aceptado y restauración comprobable. Usar de nuevo el bridge 3B-7 en modo `HANDSHAKE_ONLY_NO_AGENT_PROCESS` no iniciaría Merlin. **3B-8/I**, si se decide posteriormente, exige adicionalmente proveedor integrado, controles de egress/POST/grant y presupuesto acreditado antes de enviar `chat`.

## 6. Código entregado en la rama del PR #66

- `scripts/full-integration/original-merlin-process-gate.mjs` y `.test.mjs`: gate offline de selección sin chat; rechazo de frames y de identidad indebida.
- `scripts/full-integration/original-merlin-worker-boundary.mjs` y `.test.mjs`: sonda directa del proceso original y negativas ambientales.
- `scripts/full-integration/original-merlin-websocket-process-offline.mjs`: ruta WebSocket local con proceso `IpcWorker` original y barrera IPC.
- `.github/workflows/buffalo-stage3b8-offline.yml`: CI acotado, sin secretos ni permisos de mutación, con dos recibos y artifact.

**Conclusión epistémica:** 3B-8/P da evidencia auténtica del **proceso** y de su **frontera offline**, no de una inferencia ni de la ruta privada real. No repetir 3B-7 ni convertir automáticamente este éxito en autorización para R o I.
