# Buffalo Control Plane — Binding real env.DB: intento de laboratorio (2026-11-21)

## Objetivo

Cerrar la brecha entre las pruebas de SQL sobre Cloudflare D1 REST (PR #20) y la ejecución de la clase original `D1TaskStore` dentro de un Cloudflare Worker con binding `env.DB`.

## Implementación efectuada

- PR #21, merged: `workers/buffalo-control-plane/binding-lab.mjs` importa `D1TaskStore` desde `store.mjs` y el contrato offline original; CI pasó **30/30** tests, además de validación SQLite. El harness carece de ruta HTTP y devuelve 404 para toda petición.
- Worker de laboratorio creado: `buffalo-binding-race-lab`. Solo módulo `binding-lab.mjs`, `store.mjs` y `contract.mjs`; **no** contiene `GitHubOffline`, credenciales GitHub ni `ControlPlaneService.dispatch`.
- Binding `DB` apunta exclusivamente a `d1e23807-b076-4c36-8785-7b423fc41614` (base aislada `buffalo-control-plane-race-lab-20261121`).
- Se verificó con API Cloudflare: `workers.dev` **disabled**, previews **disabled**, sin otros bindings.
- En D1 de laboratorio se creó tabla `buffalo_binding_lab_receipts(test_id,status,failure_stage,failure_code,detail_json,created_at,finished_at)`.
- Se activó cron `* * * * *` por un periodo limitado, luego se consultó la tabla de recibos repetidamente.

## Resultado observado

**NO CONCLUYENTE — NO DECLARAR PASS.** Hasta la última consulta, la tabla `buffalo_binding_lab_receipts` no tenía ninguna fila; no hay evidencia de que el scheduled handler haya entrado en ejecución. La API de Cloudflare confirmó cron configurado, pero la propagación de triggers nuevos puede tardar varios minutos (documentación de Cloudflare: hasta 15 minutos). No se observó ni `PASS` ni `FAIL`; esto no prueba un fallo en `D1TaskStore`.

Para no dejar una tarea programada fuera de control, se ejecutó `PUT /workers/scripts/buffalo-binding-race-lab/schedules` con `[]` y se verificó `GET` que **schedules = []**. La desactivación también puede tardar en propagarse, por lo que la protección idempotente de `test_id` sigue siendo importante y se debe revisar la tabla antes de cualquier nuevo intento.

## Escenarios codificados (todavía sin recibo de ejecución remota)

1. Ocho llamadas paralelas a `D1TaskStore.create`: exactamente un `TASK_ADMITTED`.
2. Ocho llamadas paralelas a `D1TaskStore.claim`: exactamente un `DISPATCH_CLAIMED`.
3. Dos transiciones terminales rivales: un único estado y un único evento terminal.
4. Dos `linkRun` rivales: una asociación persistida y un solo evento.

Los IDs, SHA y números de run son **sintéticos**. No se disparó GitHub Actions ni se solicitó inferencia de IA.

## Siguiente decisión

Para validar `env.DB` sin depender de la propagación de cron, considerar un harness activable bajo autenticación fuerte en un entorno aislado, con un trigger de un solo uso y sin pasar por el Worker original, o usar el flujo documentado de pruebas remotas del entorno de desarrollo. En cualquier caso, no alterar D1 de producción y comprobar recibos antes de ejecutar otro experimento.

## Invariantes

La prueba positiva histórica de producción sigue identificada por tarea `d3af46b3-01ce-4c28-ba24-31d52a908464`, run `44956533083` y artefacto `14728065888`. No fue utilizada como sujeto de este laboratorio.
