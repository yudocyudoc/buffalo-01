# Buffalo Full × Control Plane — integración progresiva, etapa 1

**Fecha:** 2026-11-21. **Alcance:** compuerta estática de identidad e integridad de los componentes originales; **sin inferencia ni ejecución de agentes**.

## Fuentes inspeccionadas directamente

- `agent/AgentOrchestrator.js`: exporta `AgentOrchestrator` y coordina las conversaciones y herramientas.
- `agent/utilities/AgentEvalRunner.js`: exporta `runAgent(prompt, currentModel, parameters)`, importa el orquestador y `PySDSimulator`, carga el archivo de agente desde `agent/config/${agentName}.md`.
- `agent/config/{merlin,socrates,themis,athena_SFD}.md`: cuatro personalidades originales con frontmatter `agent_mode`, `max_iterations`, `supported_modes`; la modalidad `sfd` está presente en las cuatro. **Socrates** y **Athena** usan modo manual, Merlin y Themis modo sdk según sus archivos actuales.
- `evals/categories/policyImplementation.js`: `groups`, `evaluate`, criterios `meetsGoal`, `intact`, `sensible`; el evaluador puede simular con PySD y contiene grupos dev/held-out. No se invoca el evaluador en etapa 1.
- `evals/utilities/simulator/PySDSimulator.js`: exporta la clase `PySDSimulator`.
- `scripts/run-one-native-agent-case.mjs`: runner existente, importa `runAgent`, `groups`/`evaluate` y conserva el consentimiento `BUFFALO_PAID_RUN=I_ACCEPT_CLOUDFLARE_AI_COSTS`; allowlist exacta `merlin, themis, socrates, athena_SFD`.
- `.github/workflows/paid-agent-case.yml`: workflow manual distinto, protegido por consentimiento explícito; ejecuta el runner original mediante `scripts/cloudflare/bootstrap.mjs`.

## Conexión implementada (sin cambiar el contrato D1)

**Punto de conexión:** `.github/workflows/buffalo-control-plane-offline.yml`, justo después del test del contrato offline y **antes** de generar el JSON ZIP ya verificado por D1.

`node scripts/full-integration/original-gate.mjs --check`:

1. Lee los diez archivos originales de una allowlist fija, sin importarlos ni ejecutarlos. Rechaza archivos ausentes, enlaces simbólicos y cambios que rompan los sentinelas de interfaz.
2. Confirma la identidad de los cuatro agentes, su modo SFD, la allowlist del runner y la protección explícita del workflow de pago.
3. Confirma exports/rutas del orquestador, eval runner, simulador, benchmark y los tres criterios.
4. Produce salida determinista `BUFFALO_ORIGINAL_SOURCE_PREFLIGHT_V1` con hashes SHA-256 individuales y un fingerprint global `source_sha256`. Son huellas de **código leído**, NO pruebas de comportamiento, de evaluación, de contenido semántico de los agentes ni de ejecución de modelos.
5. En caso de desviación, falla el job **antes** de crear el artefacto offline. La verificación del resultado offline, su esquema y su único artifact siguen idénticos.

**No se cambian** `agent/**`, `evals/**`, `scripts/run-one-native-agent-case.mjs`, `paid-agent-case.yml`, Workers productivos, esquema D1, secretos, prompts, PySD ni graders. No se permite despacho del workflow pagado desde el control plane.

## Tests negativos automatizados

`scripts/full-integration/original-gate.test.mjs` comprueba:

- Reconocimiento de los cuatro agentes y fingerprint determinista.
- Fallo cerrado cuando falta una configuración de agente.
- Rechazo del drift de allowlist del runner original.
- Rechazo si desaparece el consentimiento explícito del runner.
- Rechazo si desaparece la interfaz `evaluate` del benchmark.
- Distinción entre cambio legítimo de bytes (hash cambia) e incumplimiento de estructura.

La CI offline del control plane vuelve a comprobar el gate cuando cambian estos archivos; esto evita que una modificación en una personalidad o en un grader lo eluda silenciosamente.

## Importantes límites epistémicos

- Este gate verifica **presencia y estructura mínima de código**, no comportamiento correcto de Merlin, Sócrates, Themis, Athena ni de PySD.
- La huella SHA no es firma y no queda persistida en la D1 por esta etapa; el control plane sigue verificando el artifact offline original. Se deliberó no añadir un segundo artefacto a ese workflow porque `github.mjs` exige exactamente uno; alterar la cardinalidad invalidaría la verificación anterior.
- El workflow offline continúa con un solo `BUFFALO_OFFLINE_ECHO_V1` y sin nuevos tipos; no se requiere migración para esta etapa.
- No se ejecutó el workflow pagado ni se alteraron límites de consumo. Ninguna métrica de calidad del agente se infiere de estas pruebas.

## Hitos siguientes y compuertas antes de inferencia

**Etapa 2 — recibo de handoff firmado por artefacto:** diseñar un nuevo tipo de tarea y un contrato de salida versionado; persistir identidad del caso, hashes de entrada/config/modelo y preflight de origen con pin del commit, sin cambiar el contrato de `BUFFALO_OFFLINE_ECHO_V1`. Requiere migración explícita y tests negativos de idempotencia y evidencia.

**Etapa 3 — smoke de orquestación sin proveedor:** ejecutar una sola instancia de `runAgent` con transporte inyectado y responder deliberadamente sin realizar POST de inferencia; medir las salidas verificables sin declarar que el agente completó el benchmark.

**Etapa 4 — primera ejecución real de agente:** solo tras autorización expresa de costo, presupuesto de llamadas, límites de tiempo, criterios de interrupción, conservación de provider receipts y un solo escenario seleccionable. No se habilita en etapas 1–3.

**Condición de cierre de etapa 1:** CI de gate estático y tests negativos pasan en PR; tras merge, `main` contiene el gate offline. No se requiere despachar una nueva tarea real de GitHub para probar preservación; una ejecución posterior del workflow offline necesitará un UUID nuevo y no podrá atribuirse al run histórico.
