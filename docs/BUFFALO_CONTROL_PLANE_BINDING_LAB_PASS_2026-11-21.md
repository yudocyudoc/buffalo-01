# Buffalo Control Plane — Recibo final del binding Worker → D1 real

**Fecha:** 2026-11-21  
**Veredicto:** PASS (4/4 pruebas de concurrencia acotadas)  
**Repositorio:** `yudocyudoc/buffalo-01`  
**Harness:** `workers/buffalo-control-plane/binding-lab.mjs`, PR #23  
**D1 aislada:** `buffalo-control-plane-race-lab-20261121` (`d1e23807-b076-4c36-8785-7b423fc41614`)  
**Worker aislado:** `buffalo-binding-race-lab`  
**Recibo persistido:** `buffalo-binding-2026-11-21-v1`

## Contexto

La prueba anterior, documentada en PR #20, verificó el SQL mediante API REST de D1. El intento programado en PR #21–22 no produjo un recibo durante la ventana observada. Para cerrar específicamente la brecha `env.DB` se ejecutó el mismo `D1TaskStore` original dentro de Cloudflare Worker real mediante POST manual protegido por Cloudflare Access (PR #23). El laboratorio estuvo conectado solamente a la D1 experimental. No se utilizó el Worker ni la D1 de producción.

## Recibo primario observado en D1

Consulta ejecutada sobre D1 de laboratorio:

```sql
SELECT test_id,status,failure_stage,failure_code,detail_json,created_at,finished_at
FROM buffalo_binding_lab_receipts;
```

Campos observados:

- `test_id`: `buffalo-binding-2026-11-21-v1`
- `status`: `PASS`
- `failure_stage`: `NULL`
- `failure_code`: `NULL`
- `created_at`: `2026-11-21 23:10:00` (UTC)
- `finished_at`: `2026-11-21 23:10:01` (UTC)
- `backend` dentro de `detail_json`: `CLOUDFLARE_WORKER_ENV_DB_BINDING`
- Contadores declarados por harness en el recibo: `http_dispatches=0`, `github_requests=0`, `inference_requests=0`. Son contadores definidos por el código del harness; no son una auditoría independiente del tráfico externo.

| Escenario | Intentos | Ganadores | Evento observado | Veredicto |
|---|---:|---:|---:|---|
| `concurrent_create` | 8 | 1 | `TASK_ADMITTED` = 1 | PASS |
| `concurrent_claim` | 8 | 1 | `DISPATCH_CLAIMED` = 1 | PASS |
| `concurrent_terminals` | 2 | 1 | Terminal = 1; estado final `FAILED` | PASS |
| `concurrent_link` | 2 | 1 | `GITHUB_RUN_LINKED` = 1; ID sintético `70002` | PASS |

Se verificaron independientemente del JSON del endpoint los registros persistidos en `buffalo_tasks` y `buffalo_task_events` de laboratorio:

- `90000000-0000-4000-8000-000000000101`: estado `DISPATCHING`, un evento de admisión y un claim.
- `90000000-0000-4000-8000-000000000102`: estado `FAILED`, `github_run_id=50001`; un evento de admisión, un claim, un `GITHUB_DISPATCH_ACCEPTED` **sintético** y un `GITHUB_RUN_NON_SUCCESS` **sintético**.
- `90000000-0000-4000-8000-000000000103`: estado `SUBMITTED`, `github_run_id=70002`; un evento de admisión, un claim, un `GITHUB_DISPATCH_ACCEPTED` **sintético** y un `GITHUB_RUN_LINKED`.

**Advertencia metodológica:** el `FAILED` terminal es el ganador válido de una carrera entre transiciones; no significa que falló la prueba. Ninguno de los IDs sintéticos se corresponde con una ejecución real de GitHub.

## Invariantes de seguridad y cierre

Antes de habilitar el endpoint, se verificó en Cloudflare Access la aplicación `buffalo-binding-race-lab - Cloudflare Workers` (`31b12640-25dc-4360-8f80-836d21850373`) con `allow` para `cloudflare_account_member` de la misma cuenta. El endpoint aceptó únicamente el cuerpo JSON literal `{"action":"RUN_BINDING_LAB_V1"}`; el registro D1 único impide una segunda corrida del mismo test ID. Los tests automatizados del PR #23 pasaron 31/31.

Tras verificar el recibo primario:

- Se ejecutó el cambio de subdominio `enabled=false, previews_enabled=false`.
- La consulta posterior confirmó subdominio y previews deshabilitados.
- La consulta de schedules confirmó `[]`: **sin cron activo**.
- No se eliminaron la D1 de laboratorio ni sus recibos, para conservar evidencia.

La tarea histórica de producción `d3af46b3-01ce-4c28-ba24-31d52a908464` permanece `SUCCEEDED`, con `github_run_id=44956533083`, `github_artifact_id=14728065888`, `result_sha256=57088281d3b355ec619bfd8d4703a3c27f776a63b424673abaf9e83bd0393b7d`.

## Alcance demostrado y pendiente

**Demostrado:** para estos casos acotados, las operaciones originales de `D1TaskStore` funcionan y respetan la exclusión condicional y la cardinalidad de eventos **a través del binding `env.DB` dentro de un Worker desplegado**, además de pruebas previas de SQL REST y una ejecución offline positiva real de GitHub.

**No demostrado:** ausencia absoluta de carreras en toda escala, robustez ante particiones, garantías exactamente una vez de GitHub en cualquier fallo, operación continuada, orquestación de Merlin/Sócrates/Themis/Athena, resultados PySD, calidad de agentes o costo de inferencia.

**Próximo paso propuesto:** fase de integración de Buffalo Full por contratos y flags explícitos; empezar con lectura y definición de interfaces de las cuatro funciones existentes, sin habilitar proveedores ni rutas pagadas. Preparar precondiciones, límites de ejecución, criterios de salida y nuevos recibos antes de permitir inferencia real.
