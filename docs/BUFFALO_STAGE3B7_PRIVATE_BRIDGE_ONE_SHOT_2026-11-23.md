# Buffalo 3B-7 — Prueba privada del bridge completo

**Fecha:** 2026-11-23 (México). **Estado:** código propuesto; aún sin ejecución real. El recibo exitoso de 3B-6 no demuestra la ruta completa.

## Pregunta

¿Puede un Worker Bridge ejecutar por Service Binding RPC → Router → Durable Object → Container Node original, pasando por el filtro OriginalHandshakeFrameGate, la secuencia HTTP 101 → session_created → initialize_session → session_ready → disconnect → close?

El objetivo NO incluye chat, select_agent, herramientas, proveedor LLM, predicción ni modificación de modelos.

## Contrato

- **Fuente:** commit a8b1ad0c02d5c3367bd24962e8fd36d277a8135d, Merlin DEV case 0 y modelo SHA256 57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39. No crear una nueva inferencia.
- **Entrada:** solo el handler scheduled() temporal del bridge; el fetch por defecto devuelve 404. En el router, el fetch público original permanece cerrado. Ambos Workers mantienen workers_dev=false, preview_urls=false y ninguna route.
- **Conexión:** el bridge utiliza una instancia nombrada BridgeProbePort de WorkerEntrypoint, accesible solo a quienes tengan un Service Binding a ese entrypoint; no publica URL alguna.
- **Control:** ambos lados vuelven a comprobar fuente D1, ausencia de grants y modo HANDSHAKE_ONLY_NO_AGENT_PROCESS. El Durable Object escribe un claim nuevo buffalo-probe-3b7-once antes de cualquier intento de arrancar el Container; no permite retries.
- **Credenciales:** dos claves temporales generadas en memoria del DO y entregadas mediante RPC al bridge. Nunca se guardan en D1, DO storage, GitHub ni logs. El filtro existente inyecta la autenticación al mensaje de inicialización. No se crean secretos permanentes.
- **Container:** imagen OCI fijada por digest, lite, enableInternet:false, inactivityTimeout 60 segundos; como máximo un arranque y un upgrade WebSocket de la prueba.
- **Resultado:** recibo sin credenciales en el almacenamiento DO y en la tabla D1 experimental buffalo_stage3b7_private_bridge_receipts. No cambia tablas históricas de fuente, handoff o grants.

## Ejecución manual y restauración

Workflow: .github/workflows/buffalo-stage3b7-one-shot-private-bridge.yml. Nunca se ejecuta por PR o push.

Inputs:
- source_commit = a8b1ad0c02d5c3367bd24962e8fd36d277a8135d
- approval = ONE_PRIVATE_BRIDGE_HANDSHAKE_NO_INFERENCE

Precheck de Cloudflare: cero Containers, cero Cron, sin dominios públicos ni secretos, bridge original solo con binding DB. Después: dry run, deploy temporal del router nombrado y del bridge con Cron, ventana observacional acotada y lectura independiente del recibo D1.

La limpieza ALWAYS restaura primero el bridge original con solo D1 y sin Cron, después el router original sin Cron. El readback final exige cero Cron, Containers y otros bindings nuevos. **Si el workflow se cancela o la limpieza falla, podrían permanecer los módulos temporales: restaurar manualmente antes de otra acción.** Un cron tardío puede dar NO_RECEIPT sin refutar la compatibilidad técnica.

## Criterio verificable

Recibo REAL_BRIDGE_HANDSHAKE_PASS en D1 con http_101, session_created, session_ready, disconnect_sent y connection_closed verdaderos, más frame_types igual a [session_created, session_ready]. GitHub verde no sustituye el recibo.

Si falla o no deja recibo: resultado negativo o inconcluso del intento único, sin repetirlo automáticamente. Si pasa: conectividad de la ruta completa, no validación de inferencia ni telemetría medida de cero solicitudes a proveedor.

El riesgo de ejecución es como máximo un Container facturable. La autorización para preparar código no autoriza su despliegue; se requiere decisión explícita sobre el intento manual.
