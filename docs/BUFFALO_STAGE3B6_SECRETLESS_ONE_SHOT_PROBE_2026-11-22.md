# Buffalo 3B-6 · Primera sonda real sin secretos permanentes

Fecha: 2026-11-22 (Mexico City). Estado actual: **propuesta en código** hasta que pasen CI y la ejecución manual. El handshake Cloudflare todavía no está probado.

## Objetivo limitado

Demostrar **Worker privado → Durable Object por RPC → Container con el Node WebSocketHandler ORIGINAL**, en modalidad `HANDSHAKE_ONLY_NO_AGENT_PROCESS`, y registrar `HTTP 101 → session_created → initialize_session → session_ready → disconnect → close`. Esto **no** pasa todavía por `buffalo-original-ws-bridge-lab`; no presentarlo como prueba completa del puente. La suite Node offline ya cubre el rechazo de `chat` y `select_agent`; esta sonda no declara medido ese rechazo en Cloudflare.

## Simplificación respecto del PR #60

- **Cero secretos nuevos**; no es necesario pedir `BUFFALO_CF_D1_READ_TOKEN`, ni los valores A/B/C del flujo anterior.
- **Ninguna URL pública**: se usa el Worker `buffalo-private-origin-router-lab` existente, con `workers_dev=false` y `preview_urls=false`; se conserva el `fetch` normal del router, que permanece cerrado sin secretos.
- La entrada de la prueba es `scheduled()` privada, no un endpoint HTTP. Invoca el método RPC `runOneShotProbe()` de la clase `BuffaloHandshakeContainer` dentro del Durable Object nombrado fijo.
- El Durable Object hace una **reclamación permanente con transacción** (`buffalo-probe-3b6-once`) **antes** del arranque. Un cron repetido no puede volver a iniciar la prueba ni generar otra sesión. Si el primer intento falla, **no se reintenta automáticamente**.
- Las dos claves distintas requeridas por el WebSocket original (`AUTHENTICATION_KEY` y `BUFFALO_ORIGIN_UPGRADE_TOKEN`) se generan mediante `crypto.getRandomValues` dentro del DO, pasan al Container mediante `start({env})` y no se escriben en D1, DO storage, GitHub, recibos, logs o conversaciones. No dependen de GitHub Secrets. El Container mantiene `instance:'lite'`, `enableInternet:false` e inactividad 60 s.
- El caso Merlin de desarrollo se obtiene **sin evaluar modelos ni llamar agentes** desde `policyImplementation`. `generate-probe-model.mjs` compara `SHA256(JSON.stringify(model))` con `57fed631...`. Si no coincide, ni siquiera genera el archivo y Wrangler no puede desplegar.
- Antes de hacer RPC, el Worker usa **su propio binding D1 experimental** para comprobar handoff `f9c4db4e...`, runtime OCI `a8b1ad0...`, prueba `SOURCE_ATTESTED`, `execution_allowed=0` y **cero grants**. Esto no necesita token adicional de API D1.
- Un recibo mínimo, sin credenciales, se guarda en una tabla **nueva y exclusivamente experimental** `buffalo_stage3b6_private_probe_receipts`. No modifica `buffalo_full_handoffs`, `buffalo_full_source_attestations` ni `buffalo_full_live_grants`. Si falla la compuerta de D1, no arranca el Container y no hay recibo de éxito.

## Ejecución y limpieza

El workflow manual `.github/workflows/buffalo-stage3b6-one-shot-rpc-probe.yml` reutiliza **solo el GitHub secret de despliegue existente** `BUFFALO_CF_WORKERS_DEPLOY_TOKEN`. Requiere dos entradas exactas:
- `source_commit=a8b1ad0c02d5c3367bd24962e8fd36d277a8135d`
- `approval=ONE_PRIVATE_ORIGIN_PROBE_NO_INFERENCE`

Comprobará el mapa de imagen y la ausencia de instancias, secretos y subdominios públicos. Generará el modelo, hará un dry run y desplegará **temporalmente el mismo origen privado** con una tarea programada. Esperará una ventana acotada de 10 minutos y, mediante `if: always()`, restaurará la configuración original `wrangler.private-origin.jsonc` que carece de cron y de la nueva RPC. No reconfigura el puente, ni publica la imagen, ni concede inferencia.

**Riesgos que subsisten:** la ejecución de Cron de Cloudflare puede retrasarse; por ello 10 minutos no garantizan recibir el evento. Que el workflow termine en verde **no significa** handshake exitoso. Se debe comprobar el recibo D1 y la telemetría de Cloudflare por separado. La reclamación del DO impide reintentos, pero si GitHub cancela o falla antes del paso de limpieza, podría quedar temporalmente el Cron; en tal caso restaurar manualmente con Wrangler el archivo original. No afirmar `provider_requests=0` medidos por el Worker: el Wrapper Node prohíbe la ejecución de agentes, pero no hay telemetría live del proveedor en esta sonda.

Esta sonda **sí inicia un Container facturable como máximo una vez** si el trigger llega y superan las comprobaciones; no iniciar en producción ni en otro namespace. El Worker original de Buffalo y el resto de Cloudflare productivo permanecen sin cambios.

## Decisión posterior

Solo si el recibo real confirma `REAL_ORIGIN_HANDSHAKE_PASS` y la aplicación retorna a 0 instancias, plantear el segundo paso: **sonda privada a través del bridge**. No confundir la prueba directa del origen con `bridge → router → DO → Container`.
