# Buffalo Full · 3B-6 · secretos del canal privado y gate del puente

Fecha 2026-11-22/23. Alcance de este PR: **control previo y workflow manual del bridge**, no handshake ni despliegue automático.

## Evidencia previa

- [Run del origen #45113671116](https://github.com/yudocyudoc/buffalo-01/actions/runs/45113671116) **SUCCESS**.
- Versión activa `1f70ccc3-d206-4275-a159-0a411788ee8b`, cuya API de versión expone `containers[0].images.base=registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/buffalo-private-origin@sha256:9db33d0be768d4f70e3dfed21b87b0d048f9a5a63739b8301b324deab020ec1d`.
- Router privado `workers.dev=false`, previews false, DO `BuffaloHandshakeContainer`; app `buffalo-private-origin-lab` sin instancias activas ni starting, consumo 0. Bridge `buffalo-original-ws-bridge-lab` todavía solo D1, sin servicio privado.
- Handoff `f9c4db4e-aa31-4b2a-921e-201a5a79fd37`, commit OCI `a8b1ad0c02d5c3367bd24962e8fd36d277a8135d`, atestación D1 y 0 grants. El recibo D1 proviene de la API (no fue ejecutado en el Worker el servicio de atestación).

## Secretos: nunca se colocan en GitHub ni en archivos

El intento de escritura programática de secretos mediante esta integración fue bloqueado por controles de seguridad; **no se escribieron valores ni se deben reintentar de otra forma para eludir el bloqueo**.

Se deberán generar **tres valores criptográficamente aleatorios, diferentes, de al menos 32 caracteres**, preferiblemente 64 caracteres hexadecimales, mediante un gestor de contraseñas. No usar el token de API de Cloudflare ni los hashes del manifiesto o la imagen.

Desde el Dashboard de Cloudflare, en cada Worker de laboratorio, sección Settings → Variables and Secrets, tipo **Secret**:

| Worker | Nombres y valores |
|---|---|
| `buffalo-private-origin-router-lab` | `BUFFALO_ORIGIN_AUTH_KEY` (valor A), `BUFFALO_ORIGIN_UPGRADE_TOKEN` (valor B) |
| `buffalo-original-ws-bridge-lab` | `BUFFALO_ORIGIN_AUTH_KEY` (mismo A), `BUFFALO_ORIGIN_UPGRADE_TOKEN` (mismo B), `BUFFALO_WS_LAB_BEARER` (valor C, único) |

Es fundamental que A y B **coincidan exactamente en ambos Workers**. No se pueden recuperar los valores de secretos desde la API; el gate únicamente verifica sus nombres y que los dos secretos del origen estén en la **versión activa**. Se debe confirmar en Cloudflare que la versión que contiene A y B está desplegada. No adjuntar los tres valores en tickets, logs, mensajes, GitHub Secrets ni conversación.

## Compuerta automática previa al bridge

`stage3b6-prebridge-deploy.mjs` comprueba sin modificar Cloudflare: una sola aplicación privada, 0 instancias, subdominios/previews deshabilitados, imagen y SHA correctos en la versión del router activa, secretos del origen activados, secretos del bridge presentes, bridge con solo `DB` y esos tres secretos (sin servicio preexistente), D1 del handoff y source proof correctos, 0 grants.

Un resultado PASS **no** comprueba que los valores A y B coinciden; ello se comprobará exclusivamente mediante una conexión controlada del protocolo original. Tampoco comprueba ausencia de todas las rutas de zona, que debe verificarse adicionalmente mediante configuración y Cloudflare Dashboard.

El workflow manual `.github/workflows/buffalo-stage3b6-private-bridge-deploy.yml` exige:
- `handoff_id=f9c4db4e-aa31-4b2a-921e-201a5a79fd37`
- `approval=DEPLOY_BRIDGE_PRIVATE_NO_HANDSHAKE`
- GitHub Action secret `BUFFALO_CF_WORKERS_DEPLOY_TOKEN`, previamente usado solo para desplegar el origen.

Antes de desplegar corre pruebas locales, dry run de Wrangler y gate live de solo lectura. Solo entonces despliega **el Worker bridge del laboratorio**, con service binding `BUFFALO_ORIGIN` fijo al router y D1 experimental. Comprueba a posteriori binding, nombres de secretos, ausencia de workers.dev/previews y 0 instancias. No lanza conexiones, no inicializa ningún Container ni concede IA.

## Hito posterior (aún no implementado)

No abrir `workers.dev` ni previews, ni inventar endpoint público de prueba. Desarrollar una sonda privada de ejecución **una sola vez**, con llamada autenticada por service binding y recibo auditable, que respete la topología `bridge → router → DO → Container`. Debe confirmar `HTTP 101 → session_created → initialize_session → session_ready → disconnect`, denegación de `select_agent` y `chat`, y retorno a 0 instancias por inactividad. La sonda se desplegará solo tras acreditar la ruta de ejecución privada y sus permisos.
