# Buffalo 3B-7 — Cron observable sin gastar un segundo Container por accidente

**Fecha:** 2026-11-23. **Estado:** cambio propuesto PR #64, no ejecutado.

## Evidencia del incidente

- 3B-6 consiguió handshake real con el Node original en Container (no es prueba del puente completo).
- 3B-7, intento 1: el token de GitHub no tenía permiso D1 Read; HTTP 403 antes del despliegue.
- 3B-7, intento 2: los Workers temporales se desplegaron, el cron apareció a las 20:44:15 UTC, y a las 20:54:15 UTC la lectura D1 devolvió HTTP 400 / SQLite 7500 «no such table»; las limpiezas del bridge y del router pasaron. No hay recibo ni tabla 3B-7 y no se observaron invocaciones en los registros consultados.
- **Hipótesis más consistente:** el cron de un minuto no se propagó dentro de los 10 minutos. Cloudflare documenta hasta 15 minutos de propagación antes del siguiente instante cron programado. La ausencia de registros NO prueba por sí misma que el handler jamás entrara.
- **Estado del claim DO tras el intento 2: desconocido.** No inferir NOT_RUN únicamente por la ausencia de una fila D1.

## Cambio del diseño: dos tablas, fases y prueba única

La migración aislada `migrations/control-plane/lab/0003_stage3b7_observability.sql` define **antes del experimento**:
- `buffalo_stage3b7_private_bridge_receipts`: recibos del DO y el bridge, con SHA de fuente, handoff y status; nunca credenciales.
- `buffalo_stage3b7_private_bridge_events`: fases inmutables, `seq` para orden real, unicidad por `probe_id, phase`. `SCHEDULED_ENTERED` es la admisión D1 atómica; un segundo cron no ejecuta otro intento.

Flujo del handler:
1. Comprobar modo sin inferencia y escribir `SCHEDULED_ENTERED` en D1 **antes de toda RPC o preflight**.
2. Si D1 devuelve conflicto: salir sin repetir ninguna operación.
3. Invocar `BridgeProbePort.readBridgeOnce()` (read-only del almacenamiento DO; **no** Container). Si no devuelve `NOT_RUN`, anotar `DO_CLAIM_ALREADY_USED` y terminar.
4. Solo tras esa comprobación: preflight D1 de origen + cero grants, RPC para preparación, WebSocket por el filtro original, recibo final. Los eventos identifican `PREFLIGHT_PASSED`, `RPC_PREPARE_REQUESTED`, `ORIGIN_READY`, `WEBSOCKET_REQUESTED` y `RECEIPT_SAVE_REQUESTED`.
5. Registrar un evento terminal para fallos o `REAL_BRIDGE_HANDSHAKE_PASS`. Nunca registrar secretos, respuestas RPC completas ni payloads del modelo.

**Importante:** la verificación previa del claim se realiza al entrar el cron, por Service Binding privado. No equivale a una inspección externa instantánea antes del despliegue. Evita consumir otra ejecución si el DO ya tenía claim.

## Migración previa: manual y fuera del workflow

**No se aplica DDL de D1 durante PR, CI, despliegue de Workers ni probe.** El token de GitHub conserva D1 Read; no se le agrega D1 Edit.

El operador autorizado debe aplicar UNA VEZ el archivo SQL sobre la D1 de laboratorio `buffalo-control-plane-race-lab-20261121`, comprobando que sea la DB exacta. Por ejemplo, desde un shell Wrangler ya autenticado y autorizado para D1 Edit:

```bash
npx wrangler@4.166.0 d1 execute buffalo-control-plane-race-lab-20261121 --remote --file migrations/control-plane/lab/0003_stage3b7_observability.sql
```

Antes de la sonda, GitHub verificará por REST/D1 Read: ambas tablas existentes, cero filas previas en ellas, permisos intactos, Workers privados, sin cron, sin Containers activos ni iniciándose. Cualquier error se detiene **antes del despliegue**. No modificar tablas de grants, handoffs ni source proofs.

## Sondeo y resultado

Tras crear el cron temporal `* * * * *`, el job sondea D1 **cada 20 segundos durante un máximo de 17 minutos**. Imprime estados sin credenciales y termina anticipadamente al ver un evento terminal o un recibo final. Tras restaurar los Workers, verifica el apagado del Container cada 5 segundos durante un máximo de 120 segundos, dentro del límite global de 30 minutos.

- Sin `SCHEDULED_ENTERED` dentro de 17 minutos: `STAGE3B7_CRON_NOT_OBSERVED_WITHIN_17_MINUTES`. No equivale a probar ausencia absoluta de invocación si la escritura D1 falló antes de confirmar el evento.
- Con `SCHEDULED_ENTERED`, pero sin evento terminal: `STAGE3B7_CRON_ENTERED_BUT_NO_TERMINAL_RECEIPT` (indeterminado, no retry).
- Claim existente en DO: `DO_CLAIM_ALREADY_USED`, prueba nueva bloqueada y cero Container adicional por diseño.
- Fallos delimitados: `PREFLIGHT_FAILED`, `RPC_FAILED`, `PREPARE_FAILED`, `HANDSHAKE_FAILED`, `RECEIPT_FAILED`.
- Éxito solo con recibo real en D1 `REAL_BRIDGE_HANDSHAKE_PASS`, cinco confirmaciones verdaderas y exactamente los frames de handshake esperados.

GitHub ahora imprime HTTP status, código y cuerpo truncado de los errores D1. Se mantienen las restauraciones independientes `if: always()` de bridge y router, la verificación de cero cron y cero Containers, service binding temporal, sin rutas públicas ni inferencia.

## Restricciones y siguiente decisión

Este PR es **instrumentación y preparación**: puede fusionarse tras CI offline, pero no debe dispararse un tercer intento por merge o por push. El SQL de migración requiere acción separada y consciente del operador. La siguiente ejecución real es una decisión distinta y puede iniciar un Container facturable si el claim DO está libre.

No se debe usar «sin recibo» como «error del protocolo». Conservamos las fronteras epistémicas de ATMS: observado / inferido / no observado.
