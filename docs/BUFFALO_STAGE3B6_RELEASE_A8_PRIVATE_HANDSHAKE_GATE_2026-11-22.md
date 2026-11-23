# Buffalo Full · 3B-6 · runtime privado fijado y handoff D1 de a8b1ad0

Fecha: 2026-11-22 (America/Mexico_City). Estado: **NO LIVE HANDSHAKE**.

## Identidad congelada del runtime original

- **Runtime** `a8b1ad0c02d5c3367bd24962e8fd36d277a8135d`, no el SHA del último commit de CI o documentación.
- Imagen privada Cloudflare Registry `registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/buffalo-private-origin@sha256:9db33d0be768d4f70e3dfed21b87b0d048f9a5a63739b8301b324deab020ec1d`; OCI manifest digest `9db33d0b...`, OCI config bytes digest `4d908f5d...`. Ambos verificados desde build y pull del mismo run [45103309725](https://github.com/yudocyudoc/buffalo-01/actions/runs/45103309725), artifact `14785929890`.
- **Handoff Merlin** `f9c4db4e-aa31-4b2a-921e-201a5a79fd37`, `dialysisClinic`, caso 0, `sfd`, manifest `4d80f1f4ee8a75ba610943826ab3858c2019a79414e5aad249f3f3342f29aa0e`, modelo inicial `57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39`.
- Source proof original: [workflow_dispatch 45103425713](https://github.com/yudocyudoc/buffalo-01/actions/runs/45103425713), first attempt, main@a8b1ad0, artifact `14786700506`; ZIP SHA `563d66a3d0905d397862f163aa770933f96c0378e51e110353397ff32b714aa1`, JSON SHA `749cc3a708965f264eb794b7108cbb81bd5528afcfd62c933ae5c051800f3739`.
- Ninguna de las imágenes de builds secundarias posteriores reemplaza esta release. `main` posterior modifica CI/configuración, pero NO el código ejecutable de Node dentro de esta imagen.

## Persistencia D1 realizada en este laboratorio

En la BD experimental `d1e23807-b076-4c36-8785-7b423fc41614` se comprobó ausencia previa del nuevo handoff y de su atestación, y 0 grants. Se recalculó `SHA256(JSON.stringify(manifest))` en el mismo orden contractual, se comparó con el SHA de GitHub y se aplicaron inserts parametrizados y transaccionales equivalentes a las sentencias de `D1FullHandoffStore.create` y `D1FullSourceAttestationStore.save`. Lecturas posteriores:

- `buffalo_full_handoffs`: un registro `REGISTERED_UNVERIFIED`, commit y modelo exactos, `execution_allowed=0`, `provenance_verified=0`, `github_run_id=NULL`.
- `buffalo_full_handoff_events`: exactamente un evento `DECLARATION_ADMITTED`.
- `buffalo_full_source_attestations`: un recibo `SOURCE_ATTESTED`, run `45103425713`, artifact `14786700506`, SHA de ZIP/JSON anteriores, `execution_allowed=0`.
- `buffalo_full_source_events`: exactamente un evento `SOURCE_ATTESTED`.
- `buffalo_full_live_grants`: **0**.

**Límite epistemológico:** Estas escrituras fueron hechas a través de la **API D1**, tras comprobar GitHub y sus hashes, no llamando en vivo al `FullSourceAttestationService.attest()` del Worker. El recibo D1 refleja la atestación externa y la integridad re-leída; **NO** demuestra ejecución live del verificador dentro del Worker. No atribuir esa prueba ni permitir inferencias basándose en este laboratorio.

## Configuración en código

- `infra/buffalo-origin/wrangler.private-origin.jsonc`: Worker `buffalo-private-origin-router-lab`, `workers_dev=false`, `preview_urls=false`, una clase Durable Object `BuffaloHandshakeContainer` con `scheduling_policy=durable_object` e imagen named `base` pinneada al manifest OCI exacto. Variables no secretas fijan `BUFFALO_ORIGIN_MODE=HANDSHAKE_ONLY_NO_AGENT_PROCESS`, `BUFFALO_ORIGIN_COMMIT_SHA=a8b1ad0...`, `BUFFALO_ORIGIN_MODEL_SHA256=57fed...`. Los dos secretos internos deben estar disponibles solo en Cloudflare: `BUFFALO_ORIGIN_AUTH_KEY` y `BUFFALO_ORIGIN_UPGRADE_TOKEN`.
- `infra/buffalo-origin/wrangler.private-bridge.jsonc`: Worker de laboratorio `buffalo-original-ws-bridge-lab` sin rutas públicas ni previews, D1 experimental fija y servicio privado `BUFFALO_ORIGIN` hacia el router. Variables no secretas `BUFFALO_WS_LAB_MODE`, `BUFFALO_LAB_HANDOFF_ID=f9c4...`, `BUFFALO_RUNTIME_COMMIT_SHA=a8b1ad0...`. Tres secretos del puente: `BUFFALO_WS_LAB_BEARER`, `BUFFALO_ORIGIN_UPGRADE_TOKEN`, `BUFFALO_ORIGIN_AUTH_KEY`. Los dos compartidos con origen deben coincidir y no deben estar en un commit, artifact ni chat.
- El controlador Node mantiene `instance='lite'`, `enableInternet=false`, un nombre fijo de Durable Object, `setInactivityTimeout(60_000)`, y bloquea `select_agent`, `chat` y `WorkerSpawner.spawn`.
- Los dos Wrangler configs y tests se someten a `wrangler@4.166.0 deploy --dry-run` sin autenticación ni deploy.

## Paso de despliegue controlado

`.github/workflows/buffalo-stage3b6-private-origin-deploy.yml` se ejecuta **solo manualmente**, mediante `workflow_dispatch`, confirmando:
- `image_source_commit=a8b1ad0c02d5c3367bd24962e8fd36d277a8135d`
- `approval=DEPLOY_PRIVATE_ORIGIN_NO_START`

Exige en GitHub el secreto exclusivo **`BUFFALO_CF_WORKERS_DEPLOY_TOKEN`**, con permisos de cuenta **Workers Scripts: Edit** y **Containers: Edit** para Buffalo. No usar el token `BUFFALO_CF_CONTAINERS_TOKEN` si este solo tiene Containers: Edit, ni ampliar el token compartido de Workers AI.

Ese workflow confirma la configuración, hace dry-run y despliega **solo el router de origen con el mapa de imágenes Wrangler**. No provisiona secretos ni conecta el puente y no llama `ctx.container.start`; por lo tanto no arranca el Container por sí mismo. Consultar readback de Worker y Container tras el despliegue, no inferir éxito solo a partir de exit code de Wrangler.

## Gate del handshake y última dependencia

El Worker privado anterior se creó mediante Worker Versions API, que adjuntó la clase al Container, pero **no** proveyó el named image map `ctx.container.images.base`. La configuración Wrangler versionada es la vía soportada para adjuntar el mapa a la versión activa. **No instalar secretos ni activar el bridge antes de validar ese readback.**

Después del deploy Wrangler: configurar secretos internamente sin exponer valores, desplegar el puente experimental con el binding `BUFFALO_ORIGIN`, comprobar `checkStage3B6PreHandshake` usando readbacks reales, y habilitar acceso controlado para una única prueba de `101 → session_created → initialize_session → session_ready → disconnect`. Validar rechazo de `chat` y `select_agent` y uso del Container después de 60 s. Sin ello, la fase 3B-6 sigue **NO COMPLETADA**.

No crear rutas ni tokens de acceso públicos por comodidad; Cloudflare Access protegido o una sonda Worker-privada expresamente controlada siguen siendo prerequisitos.
