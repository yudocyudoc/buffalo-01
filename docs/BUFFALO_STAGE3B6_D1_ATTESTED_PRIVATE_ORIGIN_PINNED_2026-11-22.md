# Buffalo Full · 3B-6 · origen privado fijado por digest

Fecha: 2026-11-22. **No hay despliegue ni Container iniciado en este PR.**

## Evidencia real del runtime fijado

Imagen de Cloudflare Registry:
`registry.cloudflare.com/e0cb52526a69c0f48f001901a5b9a640/buffalo-private-origin@sha256:a9500540247ddc8c617f381565f67720e8e720c6042381c2e135bd73430a09b9`

- `source_commit=4396d0fed42f80908b645ef15050fbe657f1a88d`
- CI imagen: [run #45092062981](https://github.com/yudocyudoc/buffalo-01/actions/runs/45092062981), PASS de test Node original en 256 MiB, push y pull del mismo digest. Artifact `14781478788`. No es firma independiente OCI.
- Nuevo handoff Merlin: `cffb07d9-78b5-464f-8194-3f6ffd144b90`, caso `dialysisClinic`, `mode=sfd`, índice 0, manifest SHA `b5c3c970ffb42a7711c89c4e6f6a80770b42e37e4c37b2c7cd1b0f9737b4e96e`.
- Source proof original: [run #45092175834](https://github.com/yudocyudoc/buffalo-01/actions/runs/45092175834), `workflow_dispatch`, primer intento, `main`, mismo commit, éxito, artifact `14781905890`.
- ZIP descargado y verificado: `92b4ac24ca17d8f110f372f56ca86a49fe9443da83246d20e56c6053bd0b047f`; único miembro `buffalo-full-source-proof.json`, SHA `0e509f2537c8ca6490e83ed13eacf320bdfb911898b7d5475d648597902c09f6`; contenido con SHA de modelo inicial `57fed6310be45c10c263aecb796eeb72f993b318c5bc770013ff35e014cb4f39`.
- Las consultas D1 a la BD experimental `d1e23807-b076-4c36-8785-7b423fc41614` confirmaron un nuevo registro `REGISTERED_UNVERIFIED`, un evento `DECLARATION_ADMITTED`, atestación `SOURCE_ATTESTED` y un evento `SOURCE_ATTESTED`, con `execution_allowed=0` y cero grants.

## Transparencia sobre persistencia

El registro y la atestación se aplicaron **directamente por la API D1** con statements y predicados parametrizados equivalentes a los de `D1FullHandoffStore.create` y `D1FullSourceAttestationStore.save`, luego se releyeron los campos y la cardinalidad de eventos. La evidencia GitHub se cotejó por el asistente usando APIs y bytes descargados, **no** fue un POST al `FullSourceAttestationService.attest` del Worker desplegado. Por tanto, el resultado de D1 es persistencia y comprobación material, pero **no** demuestra que el propio Worker haya ejecutado su verificador en la infraestructura live. Este límite debe mantenerse explícito en los siguientes recibos.

## Configuración preparada

`infra/buffalo-origin/wrangler.private-origin.jsonc`: Worker `buffalo-private-origin-router-lab`, sin `workers.dev` ni preview URLs, Durable Object `BuffaloHandshakeContainer`, aplicación `buffalo-private-origin-lab`, `scheduling_policy=durable_object`, `max_instances=1`, imagen por SHA-256 exacto. El controlador existente usa `lite`, `enableInternet:false`, timeout de 60 s y exige token interno, clave original de autenticación, SHA de modelo y SHA de commit antes de tocar el DO. La falta de esas credenciales devuelve denegación sin iniciar el Container.

El PR solo introduce configuración verificable y tests. **No** hace `wrangler deploy`, no habilita binding `BUFFALO_ORIGIN` del puente, no establece secretos, no publica el origen, no crea grants y no invoca Merlin.

## Pasos para prueba en vivo

1. Revalidar que el tag/digest remoto se conserva y que la cuenta no tiene Containers activos.
2. Desplegar solamente el Worker/DO de origen mediante configuración versionada y confirmar `workers.dev=false`, previews off y `max_instances=1`, con imagen fijada. Desplegar no es iniciar.
3. Crear dos secretos internos distintos (auth Buffalo y upgrade token) en origen y puente, más bearer de laboratorio privado. Nunca colocarlos en código, GitHub o conversación.
4. Conectar el `BUFFALO_ORIGIN` solo al puente experimental que ya usa D1 read-only y `BUFFALO_LAB_HANDOFF_ID` nuevo. Verificar que se preservan 0 grants.
5. Una única conexión de handshake con `session_created` y `session_ready`, denegación de `select_agent` y `chat`, `provider_requests=0`. Registrar arranque, cierre e inactividad. Si falta un requisito, no hacer una conexión alternativa pública.

**No confundir** la imagen fijada al commit `4396...` con posteriores commits de documentación o CI. El runtime debe seguir explícitamente fijado a `4396...` hasta que haya un nuevo ciclo completo de imagen + source proof.
