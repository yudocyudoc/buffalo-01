# 3B-8/R1 — sonda privada mínima de compatibilidad con Cloudflare

**Estado:** preparación, no autorización de despliegue. Base PR #67, commit 25354d2. R0 reprodujo NAMESPACE_CREATION_DENIED bajo Docker local; las 31 pruebas offline confirmaron el endurecimiento de WorkerSpawner. R1 no necesita dicho agente y no lo copia a la imagen.

## Pregunta y prueba
¿Admite el entorno real de Cloudflare Containers exactamente la invocación mínima de bubblewrap de R0 (mismo archivo y digest de flags)? No se repite 3B-7, no hay WebSocket, provider, PySD, agente ni inferencia. Imagen nueva con Node 22, bubblewrap y tres módulos, sin npm ni código de motor. Corre como node. No se extrapola a Cloudflare la política seccomp, capabilities o rootfs de Docker local.

Un Worker separado, sin ruta pública, llama por cron temporal a un DO fijo. Claim irreversible DO + INSERT único D1 antes de start; alarma de recuperación antes de start; una instancia lite; enableInternet:false sin interceptores. Preflight exige digest configurado igual al digest de images.base; inspect verifica la referencia en ejecución. El servidor no arranca si falta identidad/clave, no acepta comandos ni cuerpo, POST único autenticado por clave efímera. La sonda retorna solo recibo saneado ligado a run_id y commit de imagen. El DO valida y reconstruye el recibo; intenta destroy y comprueba inspect=null, guarda evidencia en DO y D1. Watchdog solo destruye, no reintenta. El límite de inactividad es una protección adicional, no un límite de facturación garantizado.

## Interpretación
- R1_REMOTE_MINIMAL_PASS: invocación mínima exit 0, receipt consistente y cierre confirmado por API del DO. NO demuestra AgentWorker ni aislamiento completo de Buffalo.
- R1_REMOTE_MINIMAL_BLOCKED: invocación real bloqueada, recibo con causa y firma saneada, no atribuir defecto a Merlin.
- R1_RUNTIME_FAILURE: fallo de preparación, imagen, transporte o evidencia, no un resultado de compatibilidad.
- R1_CLEANUP_UNCONFIRMED o R1_INTERRUPTED_NO_RETRY: incidente, revisar recursos y evidencia antes de cualquier otra acción.
- Los flags enableInternet:false y agent_execution_authorized:false son configuración/alcance, no una auditoría de egress; el recibo declara medición independiente falsa. No confundir inspect=null con telemetría agregada o instante físico de apagado.

## Lo que falta antes de ejecutar
1. Revisar PR #66/#67 y esta rama; identificar el checkout exacto de R1; verificar CI y dry-run de configuración válida.
2. Aprobar expresamente coste de **una instancia lite**, registro de imagen, Worker y migración D1. No estimar factura sin verificar plan y tarifas. No se autoriza por este commit.
3. Construir/publicar imagen con digest de base fijado y commit exacto, verificar digest de registro y source; armar config desde template con digest remoto, commit y modo explícito; verificar no rutas, previews, ni bindings a proveedores. El template tiene modo DISABLED, digest inválido y cero crons. **No desplegar el template.**
4. Preflight remoto de permisos, estado sin instancias y cero cron, migración de tabla nueva y verificación de que no hay fila R1; registrar baseline de los Workers y app de 3B-7 y no modificarlos. Configurar cron temporal en Worker nuevo solo tras aprobación y verificar una sola invocación real. El claim D1 y DO nunca se borran.
5. Leer recibo D1 directamente por API, cotejar run/commit/digest/log, detener cron y restaurar configuración desarmada aunque falle el run; verificar app nueva sin instancias y telemetría/historial por separado. Preservar evidencia, no borrar claims. Si no llega terminal o cleanup falla, desarmar y revisar estado antes de cualquier acción. **El workflow remoto manual y su runbook de restauración todavía no están implementados; no armar cron manualmente basándose solo en esta preparación.**

## Evidencia de esta entrega
CI local: unit tests con mocks de Container/D1/DO y HTTP loopback real con sonda inyectada. Build OCI local y default unarmed denial. No remoto, registro de imagen ni Cloudflare API mutante. No afirmar que mocks son la prueba R1. El fallo R0 no se cambia ni se reejecuta para esta rama.
