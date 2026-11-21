# Buffalo Full — D1 → GitHub Actions, fase 0 (contrato y runner offline)

Fecha: 21 de noviembre de 2026. Estado: **implementación de contrato y runner, sin infraestructura desplegada**. No se ha creado una D1, Worker, secreto ni despacho. Este incremento no ejecuta IA, agentes, PySD, modelos ni inferencias pagadas.

## Decisión

Conservar `agent/AgentOrchestrator.js`, herramientas y simuladores originales, el `scripts/cloudflare/bootstrap.mjs` existente y `paid-agent-case.yml` con su consentimiento manual. Incorporar un circuito de trabajo **separado** para orquestación de sesiones completas con Jobs de GitHub; evitar usar GitHub para cada `read_model_section` o `get_variable_data`.

Primera operación aceptada: `BUFFALO_OFFLINE_ECHO_V1`. Todo lo demás, incluido un caso de Merlin, debe rechazarse. La entrada tiene exclusivamente `task_id`, `kind` e `input_sha256`. El esquema `migrations/control-plane/0001_tasks.sql` es para una D1 futura y no lo aplica GitHub.

## Máquina de estados (v0)

`READY → DISPATCHING → SUBMITTED → RUNNING → SUCCEEDED | FAILED`.

Resultado de despacho sin confirmación: `DISPATCHING → DISPATCH_UNKNOWN` (o desde `SUBMITTED/RUNNING`). `DISPATCH_UNKNOWN` exige reconciliar con una ejecución GitHub auténtica; NO reintentar automáticamente. No se permite volver de estados terminales a `READY`, declarar una simulación a partir de este echo ni ejecutar tareas pagadas.

Se diferencia el estado de la llamada a GitHub del resultado del job: HTTP aceptado no equivale a job ejecutado. `workflow_dispatch` no se considera prueba suficiente de un `run_id` ni del contenido del artefacto. La asociación posterior exige `task_id`, repositorio, workflow, commit/ref, run ID y verificación de artefacto. Las transiciones futuras deben implementarse con `UPDATE ... WHERE state=...` y comprobar filas afectadas antes de enviar al proveedor. D1 y GitHub no forman una transacción distribuida.

## Qué se puede comprobar ahora

1. Ejecutar `node --test scripts/control-plane/contract.test.mjs` sin dependencias de aplicación, API ni credenciales.
2. Verificar el workflow de prueba `.github/workflows/buffalo-control-plane-offline.yml`: solo `workflow_dispatch` y un UUID, sin prompts ni comandos arbitrarios.
3. El runner `offline-echo.mjs` escribe un JSON de evidencia sintética sin simular ni usar IA; Actions sube un artefacto de siete días. **Un artifact no prueba por sí solo que D1 lo haya leído.**

## Siguiente entrega, no implementada en fase 0

- Worker privado con binding D1, autenticación antes de crear o consultar tareas y sin endpoints genéricos de shell/SQL.
- Reclamo atómico `READY → DISPATCHING` con entrada fija al workflow `buffalo-control-plane-offline.yml` y GitHub App/token limitado a `Actions: write` para ese repo; errores ambiguos quedan `DISPATCH_UNKNOWN`.
- Recepción verificable del `workflow_run` (webhook HMAC, acción, repo y workflow) y reconciliación de tarea, run y hash de bytes del artefacto antes de publicar `SUCCEEDED`.
- Tests con webhook duplicado, error de GitHub después de enviar, idempotencia entre dos Workers, run fallido, SHA incorrecto y rechazo de `paid-agent-case.yml`.

**Compuerta para pasar al benchmark**: un circuito completo offline `D1 READY → GitHub → artifact autenticado → D1 SUCCEEDED` demostrable, sin doble dispatch. Solo después evaluar el puente al benchmark completo de Merlin con autorización de costos separada. No tocar `paid-agent-case.yml` hasta que esta compuerta esté probada.
