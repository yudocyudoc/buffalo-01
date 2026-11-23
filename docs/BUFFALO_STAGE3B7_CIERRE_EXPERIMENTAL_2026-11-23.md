# Buffalo · Stage 3B-7 — Cierre experimental del handshake por bridge privado

**Fecha del ensayo:** 2026-11-23 (UTC). **Estado:** **CERRADO — `REAL_BRIDGE_HANDSHAKE_PASS`**.  
**Clase de evidencia:** recibo persistente de D1 corroborado con historial de fases, logs de GitHub Actions y consultas de configuración/estado en Cloudflare.  
**Alcance:** handshake y transporte privado completos; **sin inferencia**. No autoriza una ejecución posterior de agentes.

## 1. Pregunta y veredicto

**Pregunta:** ¿Puede el Worker Bridge privado de Buffalo realizar, a través del Service Binding RPC nombrado, el Router, el Durable Object y el Container Node original, el handshake WebSocket del protocolo original pasando por `OriginalHandshakeFrameGate`, y luego devolver la infraestructura a su estado privado?

**Respuesta observada:** **Sí, para el escenario concreto de 3B-7.** El recibo persistente en D1 declara `REAL_BRIDGE_HANDSHAKE_PASS` y confirma HTTP `101`, `session_created`, `session_ready`, envío de `disconnect`, cierre de la conexión y `frame_types=["session_created","session_ready"]`. El workflow hizo una lectura independiente del recibo y la verificó; sus pasos `ALWAYS` de restauración terminaron satisfactoriamente.

**No demuestra:** ejecución de Merlin, simulación SFD, inferencia de LLM, uso de herramientas, herramientas de agente, rendimiento bajo carga, confiabilidad estadística, ni ausencia de todas las llamadas a proveedores mediante medición de egress. El ensayo se diseñó explícitamente para **no** ejecutar inferencia; `buffalo_full_live_grants` siguió con cero registros.

### Fuentes primarias de la ejecución

- [GitHub Actions run 45282829100](https://github.com/yudocyudoc/buffalo-01/actions/runs/45282829100) — `workflow_dispatch`, `success`, primera ejecución de ese run, en `main@8e6475e3bd2116fcbb9abaf994051a0445dedd07`.
- [Job 138071431869 y logs](https://github.com/yudocyudoc/buffalo-01/actions/runs/45282829100/job/138071431869) — configuración temporal, sondeo, validación D1, restauración y verificación final.
- [PR #64, fusionado](https://github.com/yudocyudoc/buffalo-01/pull/64) — instrumentación de cron, migración de auditoría y verificación final acotada.
- Fuente de prueba original fijada: `a8b1ad0c02d5c3367bd24962e8fd36d277a8135d`; **distinta** del commit del workflow. Modelo inicial fijado SHA-256 `57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39`.
- D1 del laboratorio: `buffalo-control-plane-race-lab-20261121` (`d1e23807-b076-4c36-8785-7b423fc41614`), tablas `buffalo_stage3b7_private_bridge_receipts` y `buffalo_stage3b7_private_bridge_events`. Los valores descritos proceden de consultas directas tras el run.

## 2. Recibo D1: evidencia positiva independiente del color de GitHub

Consulta por `probe_id='one-shot-private-bridge-v1'`. Fila única observada:

| Campo | Valor observado |
| --- | --- |
| `status` | `REAL_BRIDGE_HANDSHAKE_PASS` |
| `source_commit` | `a8b1ad0c02d5c3367bd24962e8fd36d277a8135d` |
| `handoff_id` | `f9c4db4e-aa31-4b2a-921e-201a5a79fd37` |
| `model_sha256` | `57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39` |
| `http_101` | `true` |
| `session_created` | `true` |
| `session_ready` | `true` |
| `disconnect_sent` | `true` |
| `connection_closed` | `true` |
| `frame_types` | `["session_created","session_ready"]` |
| `error_code` | `null` |
| `finished_at` | `2026-11-23T22:53:30.554Z` |

El script CI terminó el paso **`Require actual D1 PASS receipt (workflow success is not proof)`** con `REAL_BRIDGE_HANDSHAKE_PASS_VERIFIED_FROM_D1` a las **22:53:38.097 UTC**. No se infiere éxito únicamente de `conclusion: success` de GitHub.

## 3. Cronología: fuentes y resolución temporal

Tiempos **UTC** del 2026-11-23. Las fases D1 `created_at` tienen resolución de segundos; los logs de GitHub y el historial de Containers incluyen milisegundos. No interpolar precisión adicional.

| Hora UTC | Evidencia | Fuente |
| --- | --- | --- |
| 22:46:49.455 | `STAGE3B7_SCHEMA_PREAPPLIED_AND_EMPTY`; preflight privado aprobado | Log de GitHub |
| 22:47:14.712 | `Deployed buffalo-original-ws-bridge-lab triggers` | Log de GitHub |
| 22:53:12 | `SCHEDULED_ENTERED`; primer evento del handler | D1 `events`, seq 1 |
| 22:53:12 | `CLAIM_READ_REQUESTED` | D1, seq 2 |
| 22:53:13 | `CLAIM_ABSENT` | D1, seq 3 |
| 22:53:14 | `PREFLIGHT_PASSED`, `RPC_PREPARE_REQUESTED` | D1, seq 4–5 |
| 22:53:15.320 | Registro `started_at` de instancia `buffalo-original-handshake-only` | API Containers `instances-v2` |
| 22:53:29 | `ORIGIN_READY`, `WEBSOCKET_REQUESTED` | D1, seq 6–7 |
| 22:53:30 | `RECEIPT_SAVE_REQUESTED`, `REAL_BRIDGE_HANDSHAKE_PASS` | D1, seq 8–9 |
| 22:53:30.554 | `finished_at` del recibo positivo | D1 `receipt_json` |
| 22:53:37.924 | CI observa por polling resultado terminal positivo | Log de GitHub |
| 22:53:38.097 | CI comprueba directamente el recibo `PASS` | Log de GitHub |
| 22:53:42.323 | `STAGE3B7_BRIDGE_RESTORED` | Log de GitHub |
| 22:53:47.698 | `STAGE3B7_ORIGIN_RESTORED` | Log de GitHub |
| 22:53:47.972 | CI verifica bindings originales y ausencia de cron | Log de GitHub |
| 22:53:48.596 | `active=0,starting=0,usage=0` | Log de GitHub; snapshot API |
| 22:54:33.204 | Instancia con `status.state=stopped` y `status.updated_at` | API Containers `instances-v2`, consultada posteriormente |

**Duraciones descriptivas:**
- Del log de despliegue del cron (22:47:14.712) al primer marcador D1 (22:53:12): aproximadamente **5 min 57 s**. Es un **tiempo observado entre eventos**, no una medición causal aislada de propagación global.
- Del primer marcador D1 (22:53:12) al `finished_at` del recibo (22:53:30.554): aproximadamente **18.6 s**, sujeto a la resolución de segundos del primer marcador.
- Desde el snapshot de cero instancias del CI (22:53:48.596) hasta el `status.updated_at` de `stopped` (22:54:33.204): **44.6 s** de diferencia entre dos superficies de telemetría, no una duración demostrada del proceso de apagado.

## 4. Traza por fases e idempotencia

La tabla `buffalo_stage3b7_private_bridge_events` contiene **nueve eventos, en orden por `seq`**, y sin `code` de error:

```text
1  SCHEDULED_ENTERED
2  CLAIM_READ_REQUESTED
3  CLAIM_ABSENT
4  PREFLIGHT_PASSED
5  RPC_PREPARE_REQUESTED
6  ORIGIN_READY
7  WEBSOCKET_REQUESTED
8  RECEIPT_SAVE_REQUESTED
9  REAL_BRIDGE_HANDSHAKE_PASS
```

`CLAIM_ABSENT` documenta que el claim persistente de DO estaba libre **cuando este handler lo consultó**. El protocolo reserva el claim una sola vez antes del arranque del Container. Las siguientes ejecuciones no deben reiniciar la sonda: el recibo y los eventos D1 existentes bloquean el preflight; además el claim durable no permite reutilizar la misma prueba.

## 5. Estado de cierre de infraestructura y matiz de telemetría

Comprobaciones posteriores independientes a GitHub, sobre Cloudflare:

- El Worker `buffalo-original-ws-bridge-lab` volvió al binding exclusivo `DB` y carece de cron.
- El Worker `buffalo-private-origin-router-lab` volvió a `BUFFALO_CONTAINER`, `BUFFALO_ORIGIN_COMMIT_SHA`, `BUFFALO_ORIGIN_MODE` y `BUFFALO_ORIGIN_MODEL_SHA256`; carece de cron.
- El consumo agregado de Containers reportó `instances=0`; la aplicación reportó `active=0` y `starting=0`.
- El historial por instancia identificó `buffalo-original-handshake-only`, creada a las 22:53:15.320, con estado final `stopped` actualizado a las 22:54:33.204.
- `buffalo_full_live_grants` conserva **0 filas**.

**Dos observaciones, no una equivalencia:** a las **22:53:48.596** GitHub leyó cero instancias agregadas; el historial registró `stopped` **44.6 s después**. No se debe afirmar que el proceso terminó físicamente exactamente cuando el contador agregado marcó cero, ni convertir `updated_at` en una medición independiente del instante físico de parada. Ambas superficies coinciden **posteriormente** en la ausencia de Containers activos.

El verificador de cierre incorporado en PR #64 sondea cada 5 s hasta 120 s si las instancias no están en cero; en este run encontró cero en su primera lectura. Esta observación **no prueba que se utilizara** su ventana máxima de espera.

## 6. Historial y límites epistémicos

- **3B-6:** handshake directo con el Container ya validado previamente; no prueba por sí mismo la ruta del Worker Bridge.
- **3B-7, intento 1 (run 45259848902, attempt 1):** error de lectura D1 (`403`) antes del despliegue temporal.
- **3B-7, intento 2 (mismo run, attempt 2):** cron temporal armado, ventana fija de 10 minutos, lectura D1 fallida (`400 / SQLITE_ERROR no such table`), sin handshake probado. Hipótesis plausible: ventana insuficiente frente al cron y su propagación; **no se probó causalmente** que fuera la única causa.
- **3B-7, nueva ejecución exitosa (run 45282829100):** esquema D1 precreado, marcador en primera entrada de cron, sondeo de hasta 17 minutos, recibo real y restauración acotada.

**Separación de afirmaciones:**

| Categoría | Afirmación |
| --- | --- |
| **OBSERVADO** | Recibo D1 con handshake original positivo, validación CI del recibo, nueve marcadores, Workers restaurados, estado final `stopped` de la instancia |
| **INFERIDO, acotado** | La demora entre deploy y `SCHEDULED_ENTERED` es compatible con propagación de Cron Triggers; no identifica por sí sola el mecanismo del retraso |
| **NO DEMOSTRADO** | Merlin ejecutando un modelo o inferencia; resultados numéricos SFD, funcionamiento bajo carga, telemetría independiente de egress/proveedor |
| **NO AUTORIZADO POR ESTE CIERRE** | Repetir `one-shot-private-bridge-v1`, limpiar el claim DO, borrar recibos de D1, desplegar una nueva fase o habilitar inferencia |

## 7. Decisión de cierre y continuidad

**Veredicto: 3B-7 CERRADA — PASS para handshake privado original completo, sin inferencia.**

No repetir 3B-7 para «confirmar» lo ya observado. Conservar el recibo y la traza D1; no modificar el claim durable ni la configuración restaurada. Una fase posterior deberá formular **otra pregunta experimental**, definir permisos y riesgo económico, diseñar evidencias y compuertas **antes** de ejecutar, y obtener autorización separada. Este documento no adelanta ni detalla esa fase.

**Principio de ATMS:** un éxito comprobado de transporte no se convierte en evidencia de simulación o inferencia. El artefacto distingue lo **observado**, lo **inferido** y lo **no demostrado**.

## 8. Referencias del repositorio

- [Workflow manual 3B-7](../.github/workflows/buffalo-stage3b7-one-shot-private-bridge.yml)
- [Contrato de ejecución y sondeo](../infra/buffalo-origin/bridge-one-shot.mjs)
- [Router, RPC y claim DO](../infra/buffalo-origin/bridge-probe-controller.mjs)
- [Verificador acotado de limpieza](../infra/buffalo-origin/stage3b7-cleanup.mjs)
- [Runbook previo de observabilidad](./BUFFALO_STAGE3B7_CRON_EVIDENCE_V2_2026-11-23.md)
- [Ejecución de GitHub](https://github.com/yudocyudoc/buffalo-01/actions/runs/45282829100)
