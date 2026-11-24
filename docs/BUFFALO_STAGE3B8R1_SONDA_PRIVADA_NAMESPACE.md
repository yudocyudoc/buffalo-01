# 3B-8/R1 — sonda privada mínima de compatibilidad con Cloudflare

**Estado:** preparación, no autorización de despliegue. Base PR #67, commit 25354d2. R0 reprodujo NAMESPACE_CREATION_DENIED bajo Docker local; las 31 pruebas offline confirmaron el endurecimiento de WorkerSpawner. R1 no necesita dicho agente y no lo copia a la imagen.

## Pregunta y prueba
¿Admite el entorno real de Cloudflare Containers exactamente la invocación mínima de bubblewrap de R0 (mismo archivo y digest de flags)? No se repite 3B-7, no hay WebSocket, provider, PySD, agente ni inferencia. Imagen nueva con Node 22, bubblewrap y tres módulos, sin npm ni código de motor. Corre como node. No se extrapola a Cloudflare la política seccomp, capabilities o rootfs de Docker local.

Un Worker separado, sin ruta pública, llama por cron temporal a un DO fijo. Claim irreversible DO + INSERT único D1 antes de start; alarma de recuperación antes de start; una instancia lite; enableInternet:false sin interceptores. Preflight exige digest configurado igual al digest de images.base; inspect verifica la referencia en ejecución. El servidor no arranca si falta identidad/clave, no acepta comandos ni cuerpo, POST único autenticado por clave efímera. La sonda retorna solo recibo saneado ligado a run_id y commit de imagen. El DO valida y reconstruye el recibo; intenta destroy y comprueba inspect=null, guarda evidencia en DO y D1. Watchdog destruye y reconcilia el recibo terminal exacto, sin reintentar la sonda. El límite de inactividad es una protección adicional, no un límite de facturación garantizado.

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
5. Leer recibo D1 directamente por API, cotejar run/commit/digest/log, detener cron y restaurar configuración desarmada aunque falle el run; verificar app nueva sin instancias y telemetría/historial por separado. Preservar evidencia, no borrar claims. Si no llega terminal o cleanup falla, desarmar y revisar estado antes de cualquier acción. **El workflow remoto existe pero no ha sido autorizado ni ejecutado.**

## Evidencia de esta entrega
CI local: unit tests con mocks de Container/D1/DO y HTTP loopback real con sonda inyectada. Build OCI local y default unarmed denial. No remoto, registro de imagen ni Cloudflare API mutante. No afirmar que mocks son la prueba R1. El fallo R0 no se cambia ni se reejecuta para esta rama.

## Workflow manual propuesto
`buffalo-stage3b8r1-private-manual.yml` exige main, SHA exacto, consentimiento literal y primer intento. Preflight de recursos nuevos; publica y compara manifest/config de imagen, dry-run, exige tabla R1 preaplicada antes de publicar, despliega desarmado, verifica estado, arma cron temporal y lee D1. Restauración always y verificación independiente de cron, configuración, agregados e instancias activas. Ventana de armado de 22 minutos calculada justo antes del deploy armado, observación hasta expiración + 4 minutos, cleanup separado de hasta 17 minutos (no equivale a límite de facturación); claim no se borra. El workflow no se ha ejecutado remotamente. Ante cancelación abrupta, expiración impide nuevos starts y watchdog/inactividad limitan actividad; se requiere verificar y restaurar por operador si CI no completa cleanup. No se autoriza gasto por este documento.

## Correcciones de revisión Astra
- Cron: documentación de Cloudflare (https://developers.cloudflare.com/workers/configuration/cron-triggers/#2-update-configuration) indica hasta 15 minutos de propagación y siguiente tick. Dry-run usa expiración pasada. El armado obtiene 22 min nuevos inmediatamente antes del despliegue; observador deriva límite de la expiración real + 4 min. Restauración tiene 17 min de verificación y job 100 min con pasos acotados. No es un límite garantizado de factura.
- D1: aplicar previamente SOLO infra/buffalo-r1/schema.sql como operación separada autorizada con credencial de escritura D1. No aplicar desde el token de despliegue. El preflight exige tabla existente y cero filas ANTES de publicación; verifica otra vez justo antes de armar. No borrar filas ni claims. La aplicación de esquema todavía no fue realizada por esta revisión.
- Recuperación: DO conserva resultado terminal inmutable; alarma destruye si hace falta y copia exactamente dicho resultado a D1 usando CAS de CLAIMED del mismo run. Si el UPDATE ya se confirmó pero se perdió la respuesta, solo acepta un resultado terminal idéntico. Un conflicto se rechaza sin sobrescribir. La alarma no inicia agente ni Container, y los reintentos de persistencia no son reintentos del ensayo. Las pruebas inyectan fallo antes y después del UPDATE, conflicto y preservación de fallo de cleanup.

## R1 v2 — contexto de ejecución y cargador ELF

El [run R1 v1](https://github.com/yudocyudoc/buffalo-01/actions/runs/45321014554) obtuvo `R1_REMOTE_MINIMAL_BLOCKED`. El hash de stderr coincide con el rechazo de capabilities que bubblewrap 0.8.0 emite antes de crear namespaces. El ELF de `/usr/bin/true` también requiere el cargador de `/lib64`, que la sonda v1 omitía.

R1 v2 ejecuta `bwrap` mediante `setpriv` y verifica en `/proc/self/status` un UID no root sin cambios, `NoNewPrivs=1` y los conjuntos `CapInh`, `CapPrm`, `CapEff` y `CapAmb` vacíos. El recibo saneado distingue un fallo de la comprobación inicial de un fallo posterior de `bwrap`. La prueba monta `/usr`, `/lib` y `/lib64` en solo lectura. El CI verifica el launcher con `bwrap --version` en la imagen Docker, sin interpretar esa comprobación como una prueba de namespaces en Cloudflare.

El workflow manual exige `ONE_PRIVATE_NAMESPACE_PROBE_V2_NO_AGENT_NO_INFERENCE`, usa una nueva identidad fija de DO y recibo (`one-shot-private-bwrap-r1-v2`) y comprueba que el Worker R1 existente esté desarmado y sin instancias antes de reutilizarlo. La tabla ya aplicada admite evidencia histórica terminal. Un claim previo de v2 o cualquier fila en `CLAIMED` bloquea el ensayo. El run v1 y su claim permanecen como evidencia histórica. La prueba remota de v2 requiere aprobación y ejecución separadas.
