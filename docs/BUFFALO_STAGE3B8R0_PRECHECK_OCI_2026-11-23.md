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

Nunca reutilizar el claim `buffalo-probe-3b7-once` ni su flujo. Las sondas ejecutan el agente, motor y WebSocket originales. El proveedor `cloudflare` **no** está registrado en el WebSocket original; para selección sin inferencia se usa `anthropic`. Para el rechazo nativo del proveedor inexistente la sonda directa original sigue siendo la evidencia, no el WebSocket.

## Regla de cierre

No declarar `3B-8/R=PASS` hasta que haya evidencia primaria de `Bridge → RPC → Durable Object → Container → WebSocketHandler → AgentWorker` desplegada y un recibo independiente de cierre del proceso. **R0 es solo una compuerta previa a R, nunca una autorización para consumir recursos.**

## Addenda R0-D1 — diagnóstico mínimo separado (23/24 noviembre 2026)

**Motivo:** [run 45306612826](https://github.com/yudocyudoc/buffalo-01/actions/runs/45306612826) produjo un build OCI correcto y un recibo `OCI_SANDBOX_BLOCKED` en el paso directo. El código 2 mostrado por GitHub corresponde al **clasificador**, no prueba que el `AgentWorker` original saliera con ese código. El primer recibo conservaba hashes de logs, pero **no** el error primario saneado de `bwrap`. La presencia de texto genérico `bwrap exited early` era suficiente para una clasificación excesivamente amplia. **No atribuir aún causa al kernel.**

Esta revisión introduce dos fronteras independientes:

1. `stage3b8r-bwrap-minimal.mjs`: ejecuta un `bwrap` real con un `/usr/bin/true` de solo lectura y los flags de aislamiento de namespace/mount necesarios; **sin importar Buffalo, crear AgentWorker, hablar con proveedores ni habilitar red**. Corre con **exactamente los mismos flags de Docker** de la sonda completa. Produce un recibo de estado y `reason_code` de una lista permitida (p. ej. `NAMESPACE_CREATION_DENIED`, `MOUNT_OPERATION_DENIED`, `PERMISSION_DENIED_UNSPECIFIED`, `BWRAP_PROCESS_FAILED_OTHER`). Conserva el SHA-256 del stderr pero **no su texto** ni rutas.
2. El clasificador R0 requiere primero un único recibo mínimo válido. Si falla, **no se intenta Merlin** y el estado será `OCI_MINIMAL_BWRAP_BLOCKED`. Si pasa, se permite el proceso directo: un fallo posterior se distingue como `OCI_ORIGINAL_WORKER_BLOCKED_AFTER_MINIMAL_PASS` y, si falla después el protocolo WebSocket, `OCI_ORIGINAL_WS_BLOCKED_AFTER_MINIMAL_PASS`. **La advertencia genérica `bwrap exited early` ya no demuestra la causa de namespaces.**

Cualquiera de los estados bloqueados conserva `ready_for_private_execution=false`, dispara CI no verde y no autoriza ninguna acción en Cloudflare. Los dos recibos originales siguen siendo obligatorios para el único PASS local. El preflight de Docker **no** equivale a comprobar aislamiento en Cloudflare Containers.

### Hallazgo de seguridad adicional: fallback del WorkerSpawner original

La implementación anterior de `WorkerSpawner` permitía un `fork` sin sandbox si faltaba `bwrap`, incluso con `ALLOW_UNSANDBOXED_FALLBACK=false`. En modo estricto, `spawn()` ahora exige Linux y `bwrap` antes de iniciar el proxy de credenciales. Si falla el arranque de `bwrap` después de localizarlo, limpia el socket IPC del intento y rechaza el spawn al agotar los reintentos. La ruta privada debe iniciar con `ALLOW_UNSANDBOXED_FALLBACK=false`.

**No relajar Docker con `--privileged`, `SYS_ADMIN`, `setuid` ni una ruta de fork para conseguir un resultado verde.** En caso de restricción de namespaces, hay que diagnosticar viabilidad de Cloudflare de manera independiente o decidir una arquitectura de aislamiento distinta mediante otro protocolo.

**Identidad de resultados:** el primer run bloqueado sigue como observación histórica; este addendum no reescribe ni sustituye sus recibos. Cualquier resultado posterior corresponde al nuevo SHA, workflow run y recibos propios.

## Addenda R0-D2 — confirmación del bloqueo de namespace (24 noviembre 2026 UTC)

**Run nuevo:** [45310592177](https://github.com/yudocyudoc/buffalo-01/actions/runs/45310592177) (head de PR probada por GitHub como merge sintético `1ad5c0b065689f5706466138a621369d4e9b9ee4`). `pure-r0=success`; el Docker OCI se construyó; el job `local-oci=failure` por **bloqueo de seguridad esperado**, no por fallos de tests de lógica.

**Prueba primaria:** `stage3b8r-bwrap-minimal.mjs` ejecutó la invocación mínima de `bwrap` con los mismos flags de Docker (`--network none`, rootfs de solo lectura, `--cap-drop ALL`, `no-new-privileges`, `USER node`, tmpfs limitado). El subproceso `bwrap` terminó con **código 1** y entregó:

- `status=MINIMAL_BWRAP_BLOCKED`;
- `reason_code=NAMESPACE_CREATION_DENIED`;
- `stderr_signature=NO_PERMISSIONS_TO_CREATE_NEW_NAMESPACE` (firma saneada de texto propio de bubblewrap, no stderr bruto);
- `stderr_sha256=f584d723d6016799815da1fe797c1cb4d40b556ab350e3d7b78d3d12d7febf46`, **idéntico** al recibido en el run anterior 45310187713, que aún clasificaba la frase como `BWRAP_PROCESS_FAILED_OTHER`.

**Cierre epistemológico:** este error es del intento **mínimo de crear namespace bajo Docker local del runner**, sin código Buffalo. Su causa observable es denegación de permisos de creación de namespace en ese entorno específico. No demuestra que el `AgentWorker` original tenga un defecto, ni que Cloudflare Containers aplique exactamente los mismos controles. La sonda directa del agente y el WebSocket **se omitieron deliberadamente**, con `ready_for_private_execution=false`.

[Artifact de dos recibos y hashes](https://github.com/yudocyudoc/buffalo-01/actions/runs/45310592177/artifacts/14883286720), ZIP SHA-256 `23ba7f44dc227dddcb2469ac93f8c11dbfdf22847a19c5fdb06b983a5cfb883e` (retención temporal de CI). GitHub corroboró la publicación y digest del ZIP; no se afirma inspección independiente de los bytes descargados.

**Decisión:** mantener PR #67 abierto como Draft, y **3B-8/R bloqueado**. No elevar privilegios, no permitir `fork` sin aislamiento, no reutilizar 3B-7, no activar cron, Container, D1 ni grants. El siguiente experimento remoto, si se autoriza después, debe comenzar con una sonda **mínima y privada** de viabilidad de namespace en Cloudflare, separada de Merlin y con coste/claim/restauración propios.
