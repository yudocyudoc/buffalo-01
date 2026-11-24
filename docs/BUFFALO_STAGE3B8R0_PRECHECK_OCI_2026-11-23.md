# Buffalo Stage 3B-8/R0 — Compuerta de viabilidad OCI previa al Container privado

**Fecha:** 23 noviembre 2026, México.  
**Estado:** código de preparación en revisión, no ejecución remota.  
**Dependencia:** 3B-8/P [PR #66](https://github.com/yudocyudoc/buffalo-01/pull/66) (offline, proceso auténtico).  
**Alcance de R0:** comprobar en Docker local sin red si **la imagen** puede iniciar y aislar el `AgentWorker` original. R0 **no es 3B-8/R PASS** ni sustituye Cloudflare.

## Pregunta del experimento

¿Al añadir `bubblewrap` a una imagen Node 22 que ejecuta Buffalo sin privilegios, puede `WorkerSpawner` seguir utilizando realmente `IpcWorker` bajo un Container Docker con rootfs readonly, `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, un solo proceso inicial de prueba y sin secretos?

Una respuesta positiva es **solo** evidencia de compatibilidad local OCI. Cloudflare Containers puede emplear restricciones diferentes del kernel, namespaces, seccomp o políticas. No se extrapola.

## Arquitectura R0

- Imagen nueva: `infra/buffalo-origin/Dockerfile.stage3b8r-probe`. `NODE_BASE_IMAGE` debe fijarse por digest, la identidad de fuente se pasa en `BUFFALO_IMAGE_SOURCE_SHA`. Instala `bubblewrap` pero no lo eleva con `setuid`; corre como `node`. **No publica servicio** y su `CMD` predeterminado sale con código 78.
- Smoke directo: `scripts/full-integration/original-merlin-worker-boundary.mjs`, tomado de 3B-8/P. Entra al orquestador original con proveedor inexistente, exige `CONVERSATION_ERROR`, procesa el modelo exacto, termina al trabajador.
- Smoke WebSocket: `scripts/full-integration/original-merlin-websocket-process-offline.mjs`, tomado de 3B-8/P. Usa `WebSocketHandler`, `WorkerSpawner`, `AgentWorker` e IPC originales en localhost; selección de Merlin sin enviar chat.
- Clasificador: `stage3b8r-oci-preflight.mjs` y su test. Requiere los recibos JSON del proceso original, mismo SHA de fuente y modelo original, verificaciones de sandbox real, terminación y estado no generativo. Un código exit 0 de Docker, sin recibos, se rechaza.
- Workflow: `buffalo-stage3b8r-local-oci.yml`, disparado **solo en PR** y con permisos GitHub `contents: read`. Build local `--load`, sin login a Cloudflare, sin push de imagen, sin D1, sin Cron y sin servicio público.
- Si faltan namespaces/bwrap, el clasificador produce `OCI_SANDBOX_BLOCKED` y el job falla **sin relajar** Docker, habilitar fork unsandboxed, aplicar privilegios ni simular una respuesta.
- Si el fallo no es de aislamiento, el clasificador devuelve error específico y falla: no degradar un error desconocido a `BLOCKED` para cubrir un defecto de código.
- Los recibos incluyen `provider_requests_measured:false`; no se afirma telemetría independiente del proveedor. Los flags de Docker y la ausencia de secretos se comprueban por el CI que ejecuta el comando, no con atestación remota independiente.

## Resultados aceptables

| Resultado | Interpretación |
|---|---|
| `LOCAL_OCI_BWRAP_AND_ORIGINAL_WS_PASS` | Dos sondas **locales** originales completadas; **no** autoriza Cloudflare |
| `OCI_SANDBOX_BLOCKED` | No puede sostenerse el aislamiento requerido en el entorno Docker del CI; no escalar privilegios |
| `3B8R0_* error` | Prueba inválida, recibo inconsistente o runtime roto; no hay evidencia suficiente |

**La mera instalación de `bubblewrap`, un build OCI verde o el cierre satisfactorio 3B-8/P no son prueba de aislamiento dentro de Containers.**

## Requisitos posteriores si R0 es positivo

Antes de 3B-8/R real todavía faltan: crear un **nuevo origen Node privado** (no el servidor handshake-only 3B-7), nuevo gate de sesión seleccionado-only y prueba de IPC, protocolo DO/Worker privado, nueva imagen de servicio registrada **por digest remoto**, atestación del commit exacto desplegado, claim irrepetible y recibo independiente, readback de D1, control de egress, restore y autorización explícita del gasto de **un Container real**.

Nunca reutilizar el claim `buffalo-probe-3b7-once` ni su flujo. El código original de Buffalo (agente, motor, WebSocket, evaluadores) permanece sin modificaciones. El proveedor `cloudflare` **no** está registrado en el WebSocket original; para selección sin inferencia se usa `anthropic`. Para el rechazo nativo del proveedor inexistente la sonda directa original sigue siendo la evidencia, no el WebSocket.

## Regla de cierre

No declarar `3B-8/R=PASS` hasta que haya evidencia primaria de `Bridge → RPC → Durable Object → Container → WebSocketHandler → AgentWorker` desplegada y un recibo independiente de cierre del proceso. **R0 es solo una compuerta previa a R, nunca una autorización para consumir recursos.**
