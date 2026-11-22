# Buffalo Full ↔ Control Plane — Etapa 2: contrato de handoff declarativo

**Corte:** 2026-11-21. **Implementación:** PR de etapa 2. **Estado de confianza de los datos:** `REGISTERED_UNVERIFIED`, no se ha autorizado ejecución.

## Decisión estructural

La D1 validada previamente usa `buffalo_tasks.kind CHECK(kind='BUFFALO_OFFLINE_ECHO_V1')`. Alterar ese CHECK obligaría a reconstruir la tabla y podría afectar el primer ciclo real validado. **Etapa 2 NO modifica tablas, tareas, workflow ni resultados V1**. La migración `migrations/control-plane/0003_full_handoffs.sql` crea `buffalo_full_handoffs` y `buffalo_full_handoff_events`, con límites SQL que prohíben expresar ejecución, verificación o run asociado.

## Contrato V1 — declaración no ejecutable

`BUFFALO_FULL_HANDOFF_MANIFEST_V1` y `BUFFALO_FULL_HANDOFF_V1` identifican **una intención de caso del benchmark**, no una orden para ejecutarlo.

| Campo | Procedencia |
|---|---|
| `handoff_id` | UUID único aportado por el solicitante, idempotente por contenido |
| `agent` | Allowlist de 4 configuraciones originales: `merlin`, `socrates`, `themis`, `athena_SFD` |
| `benchmark`, `scenario_id`, `case_index` | Caso de desarrollo `policyImplementation` tal como lo enumera el runner original; no se admite held-out |
| `commit_sha` | SHA de 40 hex del commit declarado (sin prueba de que GitHub lo haya emitido) |
| `source_sha256` | Huella de fuentes desde `inspectOriginalSources()` del gate de etapa 1 |
| `agent_config_sha256` | Huella exacta del Markdown original del agente |
| `prompt_sha256` | SHA-256 del prompt original de ese caso (sin enviar su texto a D1) |
| `initial_model_sha256` | SHA-256 de `JSON.stringify(currentModel)` del caso original (no de un modelo producido) |
| `parameters_sha256` | SHA-256 de parámetros originales de entrada y `agentName` en modo `sfd` |
| `manifest_sha256` | Digest canónico, calculado por el Worker, sobre los campos de entrada normalizados |

El manifiesto de origen se puede preparar *sin iniciar agente ni simulación* con `scripts/full-integration/prepare-handoff.mjs`. Ese script lee el benchmark original (con dependencias Node instaladas) y usa las tres pruebas hermanas `meetsGoal`, `intact` y `sensible`. El caso se enumera como en `scripts/run-one-native-agent-case.mjs`.

**Formato del POST:** solo el objeto `manifest` generado por el preparador, no su envoltura de información de diagnóstico. El campo `manifest_sha256` se calcula dentro del Worker; no se acepta como entrada.

## API autenticada, sin nuevas acciones externas

Se añaden dos rutas en el **mismo Worker** bajo su Bearer `CONTROL_API_TOKEN` y Cloudflare Access existente:

- `POST /v1/full/handoffs` → `201` al crear, `200` si el mismo UUID y contenido ya existían, `409` si se cambió algún campo.
- `GET /v1/full/handoffs/{uuid}` → recibo del manifiesto y la declaración persistida.

**No existe** ruta `/dispatch`, `/reconcile`, `/run`, ni llamada a `paid-agent-case.yml`. No se expone texto de prompt, modelo, claves ni datos de usuario. El POST requiere autorización y el límite HTTP existente de cuerpo (4096 caracteres) sigue vigente.

Las restricciones SQL impiden `execution_allowed=1`, `provenance_verified=1`, `state=SUCCEEDED` o `github_run_id` no nulo. Son decisiones deliberadas: un hash del texto declarado **no es una prueba independiente de procedencia**.

El evento `DECLARATION_ADMITTED` se inserta en el mismo `D1.batch()` que la fila, y solo si realmente se insertó la declaración. Duplicados idénticos no generan otro evento. Los eventos de handoff son independientes de los eventos originales.

## Tests y frontera probatoria

`handoff-contract.test.mjs` cubre formato estricto, rechazo de órdenes pagadas, manipulación de hashes y escenarios, rechazo de held-out, idempotencia y rutas no ejecutables.

`test-handoff-sql.py` aplica **0001 → 0002 → 0003** sobre SQLite local y verifica eventos condicionales, rollback, las restricciones permanentes de no-ejecución y la compatibilidad con la tabla original. No es por sí solo una corrida de D1 real.

La CI añade un job que carga el grupo **real** `policyImplementation` y genera un manifiesto para cada uno de los cuatro agentes sin invocar `runAgent()`, `evaluate()` ni `PySDSimulator` (instalación npm sin scripts y solo lectura de metadatos). Este job no envía un POST al control plane.

## Gates pendientes para declarar procedencia verificada

1. Aplicación explícita de `0003` a una D1 elegida y comprobación de registros en ese destino; **CI no migra producción**.
2. Un mecanismo de procedencia independiente desde un run de GitHub Actions fijado a commit y workflow autorizado. Hasta tenerlo, `provenance_verified=false` debe permanecer siempre.
3. Validación real de admisión `Worker ↔ D1` usando el esquema 0003, en entorno aislado antes de habilitar producción.
4. Si se habilita alguna vez ejecución de agentes, requiere **nuevo contrato y consentimiento de costos por separado**. No convertir automáticamente `REGISTERED_UNVERIFIED` en `SUCCEEDED`.

**Límites:** No se ejecuta inferencia, no se prueba calidad de agentes, no se produce modelo de salida, no se consume PySD. `commit_sha` es reclamado; ni el SHA del manifiesto ni el de componentes autentican un repositorio por sí solos.

## Invariantes conservados

Ningún cambio a `buffalo_tasks`, `BUFFALO_OFFLINE_ECHO_V1`, el workflow de eco, sus artefactos o a `paid-agent-case.yml`. No se toca `agent/`, `evals/`, herramientas ni prompts originales. La primera tarea remota sigue identificada por `d3af46b3-01ce-4c28-ba24-31d52a908464`, run `44956533083`, artefacto `14728065888`, y se debe verificar antes de cualquier despliegue.

## Evidencia de esta implementación (2026-11-21 UTC)

- PR #26, commit de revisión `4408d2dab7d7a8d36ab9927e83452ea027868eed`: GitHub CI reportó éxito en los jobs `control-plane-offline`, `full-handoff-source-snapshot`, `Buffalo control-plane contract (offline)`, `Go` y `Run Unit Tests`. El primero pasó las 6 pruebas de contrato handoff, 6 de source gate, 31 de control plane y dos scripts SQLite (migraciones V1 y 0003). El job de manifiestos generó un caso de desarrollo real `dialysisClinic` para `merlin`, `socrates`, `themis`, `athena_SFD` con `npm ci --ignore-scripts`, sin invocar agentes.
- Base aislada Cloudflare `buffalo-control-plane-race-lab-20261121` (`d1e23807-b076-4c36-8785-7b423fc41614`): se aplicaron las cuatro sentencias de `0003_full_handoffs.sql` sobre las tablas V1 existentes; todas respondieron `success=true`.
- D1 REST real: 8 batches simultáneos con `INSERT ... ON CONFLICT DO NOTHING` + evento bajo `changes()=1` sobre UUID **sintético** `123e4567-e89b-42d3-a456-426614174601`. Un único batch escribió (1 fila y 1 evento), los otros siete no escribieron. Se comprobó por SELECT 1 `REGISTERED_UNVERIFIED`, 1 `DECLARATION_ADMITTED`.
- D1 REST real rechazó con error de restricción las cuatro actualizaciones: `state='SUCCEEDED'`, `execution_allowed=1`, `provenance_verified=1`, `github_run_id=44956533083` (el run se utilizó solo como número sintético de intento de UPDATE, sin asociación real). Tras los rechazos, la fila seguía `REGISTERED_UNVERIFIED`, `0`, `0`, `NULL`.
- La fila de laboratorio utiliza hashes literales de prueba, incluida `manifest_sha256='9'.repeat(64)`; **no** es una huella computada del objeto real y no debe confundirse con una atestación GitHub. Las rutas del Worker calculan su propio digest al recibir un manifiesto, pero aún **no se han probado desplegadas** contra D1 0003.

**Veredicto acotado:** contrato y pruebas CI PASS; SQL de admisión/concurrencia/restricciones PASS sobre D1 real por API REST. **Worker productivo sin desplegar**, **migración 0003 no aplicada a D1 productiva**, **sin ejecución de agentes**, **sin procedencia independiente**. La etapa 2 de código queda preparada, pero no se debe declarar que el handoff HTTP remoto ha sido ejercitado hasta un smoke aislado del Worker.
