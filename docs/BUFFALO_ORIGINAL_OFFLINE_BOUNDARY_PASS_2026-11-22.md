# Buffalo Full · Etapa 3A — recibo de frontera offline del orquestador original

**Corte:** 2026-11-21 México / 2026-11-22 UTC. **Veredicto acotado: PASS** para inicialización, protocolo y rechazo explícito de proveedor; **sin salida de agente**.

## Evidencia primaria en GitHub

- Implementación integrada en el PR #38, squash merge `41c1af81df58cecfd5a757551aafc62c8e453d95`.
- GitHub Actions [run 44984804197](https://github.com/yudocyudoc/buffalo-01/actions/runs/44984804197), job `full-handoff-source-snapshot` `137092923278`, pasó la prueba del orquestador real y generó un JSON de evidencia.
- **7/7 tests de la etapa 3A PASS**, incluyendo: instancia real de Merlin y protocolo cliente, rechazo por guard ausente, rechazo del opt-in pagado, agente no permitido, índice DEV inválido, commit inconsistente, y una prueba que fuerza `fetch` y `child_process.spawn` para confirmar sus bloqueos.
- Los jobs `control-plane-offline` y `full-handoff-source-snapshot` pasaron. Los tests del control plane original también continuaron pasando.
- Artefacto de CI **`buffalo-stage3-original-offline-44984804197`**, ID **`14738779791`**, tamaño **1694 bytes**, SHA-256 del ZIP según GitHub **`b32f16dd404e4c99e64c7d74b59c7bf0f76742e83d688a5b826cfb3f122d879f`**, no expirado al consultar. La CI verificó el JSON antes de subirlo; **no afirmamos una inspección independiente posterior de los bytes del artefacto**.
- El checkout de PR CI informó SHA `5e1ba2c45609d9d3b165adbd358902f71a1e5377`, **distinto del SHA de merge a `main`**. El artefacto describe ese checkout PR, no una certificación independiente del merge final.
- En logs se registró: `schema=BUFFALO_ORIGINAL_ORCHESTRATOR_OFFLINE_PREP_V1`, `status=OFFLINE_BOUNDARY_PASS_NO_AGENT_OUTPUT`, `agent=merlin`, `scenario_id=dialysisClinic`, `network_attempts=0`, `agent_turn_executed=false`. La instancia del orquestador original imprimió el error de prueba esperado: `Unknown combination: provider=buffalo_stage3_provider_denied, loop=sdk`.

## Código original realmente ejercitado

El harness `scripts/full-integration/original-offline-orchestrator.mjs` importó **las clases originales sin modificarlas**:

1. `SessionManager`: creación de sesión `sfd`, estado, persistencia del `currentModel` de desarrollo, posterior limpieza.
2. `AgentConfigurationManager`: frontmatter original Merlin y `buildSystemPrompt('sfd')`, con SHA-256 del prompt.
3. `AgentOrchestrator` y sus proveedores de herramientas: construcción sobre la sesión real.
4. `get_current_model` de `BuiltInToolProvider`: dos mensajes y respuestas mediante un cliente determinista **solo en memoria**; el modelo original no se modifica.
5. Entrada real a `startConversation()`, que se **detiene intencionalmente en el despacho** al recibir un identificador de proveedor no registrado. El error `CONVERSATION_ERROR` y terminal `awaiting_user` demuestran que la ruta no inventó un resultado.

La preimportación `offline-egress-guard.mjs` bloqueó los transportes comunes Node y los subprocesos; además la CI no inyectó secretos de proveedores ni permiso de gasto. Su cobertura es **de proceso Node, no un sandbox de red del sistema operativo**.

## Lo que no se ejecutó ni quedó demostrado

- `AgentEvalRunner.runAgent()` **NO** fue invocado.
- Merlin **NO** generó texto ni un modelo nuevo; no hay output de agente.
- `policyImplementation.evaluate()`, graders y `PySDSimulator` **NO** se ejecutaron.
- No hubo despachos de GitHub workflow pagado ni inferencia.
- El nuevo recibo **no** es `SOURCE_ATTESTED`; registra `github_provenance_attested=false` para este checkout, independientemente de la atestación anterior de otro commit.
- No se alcanzó el turno generativo del orquestador original: el límite positivo de la prueba es su preparación, intercambio cliente y bloqueo antes de proveedor.

## Validación de continuidad después del merge

Consulta real a Cloudflare D1 productiva: la tarea histórica `d3af46b3-01ce-4c28-ba24-31d52a908464` permanece `SUCCEEDED`, run `44956533083`, artifact `14728065888`, SHA de resultado `57088281d3b355ec619bfd8d4703a3c27f776a63b424673abaf9e83bd0393b7d`.

Consulta a D1 aislada: el handoff `6bce82ee-d179-4a2e-9317-f7f4708c5be2` permanece `REGISTERED_UNVERIFIED` y `execution_allowed=0`; su atestación histórica separada permanece `SOURCE_ATTESTED`, run `44976002057`, artifact `14735612574`.

## Próxima compuerta

**Etapa 3B, no iniciada:** definir una interfaz de orquestación controlada y una evidencia *de procesamiento sin proveedor* con transiciones explícitas y separación de fuente vs. ejecución. Cualquier primer turno **real** de Merlin requerirá autorización separada (costos y proveedor), presupuesto, corte y evidencia de facturación. No reinterpretar `OFFLINE_BOUNDARY_PASS_NO_AGENT_OUTPUT` como resultado de evaluación.

Existe un workflow manual independiente `buffalo-original-orchestrator-offline.yml` que permite repetir el mismo tipo de prueba sobre `main`, pero no es necesario volverlo a ejecutar para validar esta evidencia CI.
