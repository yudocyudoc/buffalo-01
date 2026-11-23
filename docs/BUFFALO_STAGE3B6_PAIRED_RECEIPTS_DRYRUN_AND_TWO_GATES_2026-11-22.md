# Buffalo original 3B-6: unificar recibos OCI, dry-run y gates por etapa

**Fecha:** 2026-11-22 (America/Mexico_City). **Alcance:** cambios de CI y comprobadores offline; sin Container start, inferencia, cambios D1, secretos ni service bindings.

## Por qué se corrige

El workflow de publicación emitía únicamente `BUFFALO_ORIGIN_PRIVATE_REGISTRY_RELEASE_V1`, mientras que el preflight 3B-6 exigía además `BUFFALO_PRIVATE_ORIGIN_BUILD_RECEIPT_V1`. Estos recibos no son intercambiables ni es legítimo fabricarlos a partir del registro retrospectivamente. El preflight también generaba `main: infra/buffalo-origin/container-controller.mjs` pese a que el archivo debía escribirse junto al controlador; al situarlo fuera de esa carpeta Wrangler resuelve el entrypoint relativo a otra ruta. Finalmente, el preflight exigía `container_app_count=0`, pero Cloudflare ya contiene legítimamente una aplicación privada.

### Cambio 1: un mismo build, dos recibos

En el workflow de publicación, el contenedor construido desde `GITHUB_SHA` corre el servidor original con `--network none`, rootfs de solo lectura y 256 MiB. El job comprueba la salida exacta `# tests 4`, `# pass 4` y `# fail 0`.

Inmediatamente después se emite **recibo local**, con build manifest SHA-256, config digest, hashes de Dockerfile/.dockerignore, prueba de 4/4, modo de seguridad y GitHub `run_id`/`run_attempt`. Su estado temporal es `CI_BUILD_TESTED_NO_DEPLOY`; `published_to_registry=false` indica el instante previo al push.

En `main`, el mismo job hace push al registro privado, hace `docker pull` y exige match de manifiesto y config digest. Emite **recibo de registro**, con `REGISTRY_IMAGE_PULLED_AND_VERIFIED_NO_DEPLOY` y el mismo `run_id`/`run_attempt`. Ambos JSON se publican en **el mismo artifact**, no como prueba firmada.

`stage3b6-release-evidence.mjs` exige los dos recibos y coincidencia estricta de SHA, digest, config digest, run_id, run_attempt, resultado de tests y handoff de fuente. Un JSON escrito por el usuario **no es** por sí solo evidencia independiente; deben contrastarse con el artifact y las lecturas remotas reales.

La build del runtime histórico `4396d0f` no recibe recibos retrospectivos. El workflow de esta corrección crea una **nueva release candidata** en el commit definitivo de merge, con nuevo handoff Merlin inmutable `07fd7d9d-b8ec-42fe-b5e3-697bbf9901c2`; la prueba original `workflow_dispatch` se solicita por el flujo de GitHub ya existente. No registrar esa nueva identidad ni cambiar la imagen pinneada hasta validar ambas ejecuciones. El runtime `4396d0f` sigue siendo la única identidad efectivamente atestada en D1 al inicio de esta corrección.

### Cambio 2: Wrangler --dry-run y ruta estable

El archivo generado por CLI debe escribirse en `infra/buffalo-origin/wrangler.stage3b6.<identificador>.jsonc`, **junto** al controlador, con `main: ./container-controller.mjs`. La CLI rechaza rutas arbitrarias; los tests usan un fixture explícitamente sintético que no prueba el estado vivo de GitHub/Cloudflare.

El job CI `private-origin-wrangler-dry-run` ejecuta dos compilaciones con **Wrangler 4.166.0 y `--dry-run`**: configuración versionada `wrangler.private-origin.jsonc` y archivo generado por el comando real del preflight. La única red permitida es la descarga de dependencias npm; no se usan credenciales Cloudflare ni se invoca `wrangler deploy` sin `--dry-run`.

### Cambio 3: dos compuertas distintas

- `prepareStage3B6` permanece como **predeploy**: exige cero aplicaciones e instancias antes de crear infraestructura, ningún secreto o binding previo, imagen+fuente acreditadas, y produce config sin rutas públicas ni credenciales.
- `checkStage3B6PreHandshake` es **postdeploy, pre-handshake**: exige exactamente la aplicación `buffalo-private-origin-lab`, política `durable_object`, cero instancias activas/iniciándose, imagen preparada, **mapa `ctx.container.images.base` comprobado con Wrangler** y mismo digest; Worker de origen sin rutas públicas, secretos presentes solo por nombre; bridge privado ligado a `buffalo-private-origin-router-lab`, UUID/commit/modo concordantes; D1 `SOURCE_ATTESTED` con **cero grants**, sin alteraciones productivas.

Ambas son funciones **puras**: un PASS offline no certifica las lecturas de Cloudflare, la validez de secretos o la conectividad. Un PASS pre-handshake significa únicamente `OFFLINE_HANDSHAKE_CONFIG_READY_NOT_CONNECTED`, nunca HTTP 101.

## Estado de la cuenta al comenzar

`buffalo-private-origin-lab` ya existe con DO Container-enabled; imagen antigua `sha256:a9500540247ddc8c617f381565f67720e8e720c6042381c2e135bd73430a09b9` preparada (`ready`), ningún Container activo. El router privado no expone URLs, aún no tiene secretos. El Worker bridge solo conserva D1 y carece de `BUFFALO_ORIGIN`. La fuente D1 anterior está atestada para `4396d0f` mediante API D1 y evidencia GitHub, **no** mediante ejecución live del servicio de atestación del Worker.

## Puertas restantes antes del handshake real

1. Pasar CI del PR y revisar ambos recibos reales en el nuevo run de publicación de `main`; validar la nueva prueba `workflow_dispatch`, ZIP y SHA de la misma release.
2. Registrar y atestar formalmente la identidad de la nueva release en D1 experimental; no sobrescribir handoff histórico ni permitir turnos de Merlin.
3. Desplegar la configuración Wrangler privada con imagen fijada al digest verificado y corroborar el mapa `ctx.container.images.base` mediante readback; no deducirlo por el mero estado `ready` de preparación.
4. Instalar secretos internos solamente en Cloudflare, provisionar `BUFFALO_ORIGIN` en el puente experimental, ejecutar el **primer** WebSocket original `101 → session_created → initialize_session → session_ready → disconnect` y comprobar rechazo de `select_agent`, `chat` y `WorkerSpawner.spawn`. Registrar arranque, consumo y apagado.

No se realizan estas últimas acciones automáticamente al fusionar este PR. No se deben publicar valores secretos en issues, artifacts, GitHub Actions logs ni conversación.
