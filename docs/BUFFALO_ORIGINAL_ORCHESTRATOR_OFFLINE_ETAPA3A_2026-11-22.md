# Buffalo Full ↔ Control Plane · Etapa 3A — Orquestador original, frontera offline

**Fecha:** 2026-11-21 (México) / 2026-11-22 UTC.  
**Estado:** implementación en PR, CI de prueba original pendiente hasta observar los jobs.  
**Ámbito:** ensayo del **código real** de sesión, configuración y frontera de `AgentOrchestrator`, sin generación de agente.

## Justificación de la división 3A / 3B

La etapa 2.5 ya tiene una prueba independiente `SOURCE_ATTESTED` en D1 de laboratorio para un caso original Merlin/`dialysisClinic`. **Eso prueba procedencia, no autoriza una nueva ejecución.**

El `AgentOrchestrator.startConversation()` original conduce a SDK/provider y, eventualmente, herramientas, PySD y graders. No existe una opción original verificada que permita completar una conversación generativa totalmente sin inferencia. Activar un flag `offline` arbitrario o inventar una respuesta Merlin falsearía la semántica.

La etapa **3A** debe mostrar *hasta dónde* llega el orquestador original sin proveedor y **fallar con la señal correcta antes de iniciar un turno de modelo**. La etapa **3B** (futura) tratará una interfaz de orquestación supervisada y una salida distinta de `SOURCE_ATTESTED`. Nada de esto despacha el workflow pagado.

## Componentes originales utilizados (sin modificaciones)

- `agent/utilities/SessionManager.js`: crea una sesión real, guarda en su directorio temporal el modelo inicial real, mantiene estado y ciclo de vida.
- `agent/utilities/AgentConfigurationManager.js`: lee frontmatter del agente original y compone `buildSystemPrompt('sfd')` sin invocar LLM.
- `agent/AgentOrchestrator.js`: se instancia la **clase original**, con sus proveedores de herramientas reales y su servicio de sesión. Ejecuta el protocolo original `get_current_model` a través de `BuiltInToolProvider` y se llama **realmente** a `startConversation()`.
- `evals/categories/policyImplementation.js`: prompt y modelo inicial del caso DEV original, sin llamar a `evaluate()`.
- `scripts/full-integration/original-gate.mjs` y `prepare-handoff.mjs`: identidad de configuración y hashes del prompt, modelo y fuentes.

El “cliente Stella” del protocolo `get_current_model` se reemplaza **solo en memoria** por un respondedor determinista que devuelve la copia exacta del `currentModel` original (no genera ni modifica modelos). La simulación física no se invoca.

## Control de ejecución

`scripts/full-integration/offline-egress-guard.mjs` se preimporta con `node --import`, antes de importar los módulos originales. Intercepta `fetch`, llamadas comunes `http/https/net/tls/dgram` y `child_process`, rechazándolas con un error; además falla si hay credenciales de proveedor o `BUFFALO_PAID_RUN` en el proceso. El GitHub job se ejecuta sin secretos y con permiso `contents:read`. Es una barrera de defensa en profundidad **de proceso Node, no un sandbox de sistema operativo**; no se afirma que cubra todos los métodos nativos de egress.

Para evitar la carga/cualquier llamada accidental de SDK/provider, la instancia usa intencionalmente un **provider no registrado**: `buffalo_stage3_provider_denied`. El enrutador debe emitir **`CONVERSATION_ERROR`** y completar como **`awaiting_user`**. Si aparece una llamada externa, un resultado o una mutación de modelo, el ensayo debe **fallar**, nunca clasificarse como éxito del agente.

Se comprueban:

1. `SOURCE_READ_ONLY` en gate original y un caso DEV real.
2. Hash de modelo inicial idéntico al guardado por SessionManager.
3. Frontmatter/estrategia del agente auténticos; hash del system prompt original.
4. Dos solicitudes/respuestas del protocolo original `get_current_model` (sondeo de herramienta y entrada de conversación).
5. Exactamente un error `CONVERSATION_ERROR` por provider negado y cierre `awaiting_user`.
6. Cero mensajes de agente, herramientas de simulación, proveedores, procesos secundarios, grader o modelo generado.
7. Hash del modelo en memoria y disco sin modificaciones tras la entrada al orquestador.
8. Sin cambio de control plane productivo, sin asociación de GitHub run, sin escritura D1.

## Resultado y etiqueta epistemológica

`BUFFALO_ORIGINAL_ORCHESTRATOR_OFFLINE_PREP_V1` es un **recibo de frontera**:

- `status=OFFLINE_BOUNDARY_PASS_NO_AGENT_OUTPUT`: el protocolo original y la negativa de proveedor funcionaron.
- `agent_turn_executed=false`, `output_model_generated=false`, `grader_executed=false`, `simulation_executed=false`.
- `github_provenance_attested=false` **para este ensayo nuevo**, aunque exista una atestación histórica separada del caso fuente de un commit anterior. No hay inferencia de una atestación por analogía.
- `execution_allowed=false`; jamás `SUCCEEDED` como resultado de Buffalo Full.

El artefacto de GitHub Actions contiene únicamente la observación JSON de metadatos/hashes, sin texto del prompt/modelo ni tokens.

## CI y ejecución remota

- `original-offline-orchestrator.test.mjs`: prueba real de la clase original y negativas por guard faltante, consentimiento pagado, agente desconocido, caso inexistente y discrepancia de commit.
- Workflow manual `.github/workflows/buffalo-original-orchestrator-offline.yml`: **Merlin, caso 0**, rama/commit exacto `main`, `npm ci --ignore-scripts`, preimportación del guard, retención JSON 7 días. No despacha otro workflow ni ejecuta inference.
- CI del Worker ejecuta los tests de orquestador en un job aislado con dependencias instaladas (no en el job de Worker que no instala npm).

## Límite declarado

No demostramos generación de modelo ni comportamiento experto de Merlin. **Un error por provider bloqueado es el resultado buscado de esta prueba de frontera**, no una falla del sistema. La propia suite falla si el error, el protocolo o la protección no coinciden.

**Etapa 3B posterior:** diseñar una orquestación supervisada con un contrato de recibos de ejecución de evaluación/no-evaluación y no-proveedor, sin confundir historial de fuentes con un run productivo. Cualquier llamada real a un modelo seguirá requiriendo autorización explícita y presupuesto separado.
