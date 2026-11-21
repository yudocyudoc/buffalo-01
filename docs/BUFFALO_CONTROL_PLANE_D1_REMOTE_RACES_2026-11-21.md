# Buffalo Control Plane — Recibo de validación en D1 remoto (2026-11-21)

## Alcance y fronteras

**Propósito:** contrastar las sentencias SQL reales de `workers/buffalo-control-plane/store.mjs` con el motor de Cloudflare D1, sometiendo escrituras condicionales a solicitudes simultáneas, sin tocar el registro histórico ni despachar GitHub Actions.

**Recurso aislado creado:** cuenta Cloudflare `e0cb52526a69c0f48f001901a5b9a640`, D1 **`buffalo-control-plane-race-lab-20261121`**, ID `d1e23807-b076-4c36-8785-7b423fc41614`. Se aplicaron íntegramente las ocho sentencias procedentes de `migrations/control-plane/0001_tasks.sql` y `0002_dispatch_link.sql`. Base con `read_replication.mode=disabled`.

**No se modificó** la D1 de control plane original `8c44bc0c-8c49-4bc1-8a48-adb20f814a9a`, sus tareas, las configuraciones del Worker de producción, los secretos ni el historial de GitHub Actions. Ninguna llamada a Merlin, Gemma, agentes, simulación ni API de inferencia.

**Método:** Cloudflare D1 REST `POST /accounts/{account_id}/d1/database/{database_id}/query`, cuerpo `{batch:[{sql,params},{sql,params}]}`. Cada solicitud HTTP ejecutó las mismas sentencias y parámetros estructurales que el `D1TaskStore`, y las carreras se realizaron mediante `Promise.all` sobre llamadas reales a la API. Los pares `UPDATE/INSERT event` o `INSERT task/INSERT event` fueron transacciones de batch del motor D1. Verificación posterior mediante `SELECT` directo al D1 separado. Los UUID y hashes del laboratorio son sintéticos; NO son recibos de GitHub.

## Resultados observados

| Experimento | Operaciones | Resultado D1 comprobado | Veredicto |
|---|---:|---|---|
| Concurrencia de admisión, mismo `task_id` | 8 solicitudes simultáneas (2 sentencias por batch) | 1 `INSERT` eficaz, 7 sin cambio; una sola tarea `READY`, 1 evento `TASK_ADMITTED` | PASS |
| Concurrencia de claim `READY→DISPATCHING` | 8 solicitudes simultáneas | 1 `UPDATE` eficaz, 7 sin cambio; 1 evento `DISPATCH_CLAIMED` y `dispatch_head_sha` conservado | PASS |
| Estado `DISPATCHING→SUBMITTED` | 1 batch | 1 `UPDATE` y 1 evento `GITHUB_DISPATCH_ACCEPTED` | PASS |
| Carrera de terminales `SUBMITTED→SUCCEEDED` vs `SUBMITTED→FAILED` | 2 batches simultáneos | Exactamente 1 ganó; en esta corrida quedó `FAILED`; 1 evento terminal, no dos | PASS |
| Carrera de `linkRun` con ID 200 vs 201 | 2 batches simultáneos | Solo 1 `github_run_id` persistido (200 en esta corrida); 1 `GITHUB_RUN_LINKED` | PASS |
| Rollback por fallo en el segundo statement | 1 batch: `UPDATE READY→DISPATCHING` seguido de `INSERT` con FK inexistente | La API devolvió error HTTP 400 y la fila permaneció `READY`; 0 eventos para esa tarea | PASS |

En el primer lote de 8 inserciones, los metadatos de D1 reportaron `changes:[1,1]` para un único batch y `[0,0]` para los otros siete. El mismo patrón apareció para los ocho claims. Las llamadas rechazadas no generaron eventos huérfanos.

El experimento terminal usa SQL genérico de `D1TaskStore.transition`, con valores sintéticos de run, artefacto y hash aun al forzar `FAILED`. **No implica** que el servicio de Buffalo guarde evidencia artificial en un fallo real: en `ControlPlaneService`, el camino `GITHUB_RUN_NON_SUCCESS` no suministra estos campos. Este experimento valida **exclusión condicional** y no reglas de negocio ni autenticidad de GitHub.

## Qué demuestra

1. El SQL de `ON CONFLICT DO NOTHING` y de `UPDATE ... WHERE state=?` resiste estas carreras concretas en un D1 real.
2. El `changes()=1` de los eventos respeta los resultados de las mutaciones dentro de cada batch observado.
3. La operación por lotes es atómica frente al fallo inducido en la segunda sentencia.
4. Las identidades `github_run_id` competidoras no se sobrescribieron.

## Qué NO demuestra y qué falta

- **No** ejercitó la clase `D1TaskStore` a través de `env.DB.batch()` dentro del runtime de Workers, sino las mismas sentencias SQL vía la API REST de D1. No equiparar ambas rutas sin la siguiente prueba.
- **No** demuestra resistencia estadística o formal frente a todas las intercalaciones, regiones, errores de red o concurrencia masiva. Son corridas acotadas (8 + 8 + 2 + 2).
- **No** llamó a GitHub; no verifica ausencia de duplicados del lado de GitHub bajo un fallo posterior a aceptar POST.
- **No** prueba respuestas HTTP del servicio ante todas las carreras. Esas compuertas se cubrieron separadamente con mocks en PR #19 (29/29 contratos offline), y la prueba positiva remota sigue siendo run `44956533083`/artefacto `14728065888`, D1 `SUCCEEDED`.
- **No** autoriza integración de Merlin ni gastos en inferencia.

## Recomendación de siguiente compuerta

Desplegar un harness de integración **no público, con binding D1 exclusivamente al laboratorio**, que importe la implementación real de `D1TaskStore`. Repetir carreras mediante requests autenticados o test harness controlado, registrar resultados de `D1Result.meta.changes` y eventos; asegurar borrado/desactivación del harness tras el ensayo. Solo después considerar completa la compuerta `Workers binding → D1`. No modificar producción ni habilitar despacho pagado.

## Permanencia de recursos

La base de laboratorio queda segregada y con cuatro tareas sintéticas más una tarea de rollback, para auditoría; no está asociada a un Worker público. Puede eliminarse explícitamente una vez exportado el recibo y confirmados los resultados. Evitar reutilizarla para operaciones de producción.
