# Buffalo Full · Procedencia GitHub autenticada en laboratorio (V2)

**Fecha:** 2026-11-21 México / 2026-11-22 UTC.  
**Motivo:** dos recibos de laboratorio previos se conservan como `FAIL`. El primero fue `SOURCE_REAL_LAB_FIRST_ATTESTATION_REJECTED` con un GET iniciado; la sonda posterior obtuvo `HTTP_403` en `GET /actions/workflows/buffalo-full-source-proof.yml`, sin autenticación. No afirmamos que haya sido necesariamente rate limit; el 403 por sí solo no identifica la política que lo produjo.

## Decisión de credenciales

Crear un **fine-grained personal access token** GitHub dedicado (nunca el de producción), con:

- Resource owner: cuenta propietaria del repositorio `yudocyudoc/buffalo-01`.
- Repository access: **Only select repositories → buffalo-01**.
- Repository permissions: **Actions: Read-only**. Metadata read automático. Ningún write, dispatch, administración ni acceso a otros repositorios.
- Expiración corta apropiada para el laboratorio (7–30 días); revocarlo al terminar.
- Guardarlo **solo** mediante Cloudflare dashboard en el Worker aislado `buffalo-auth-source-proof-lab` como variable **Secret** con nombre exacto `GITHUB_SOURCE_READ_TOKEN`. No pegar jamás en chat, commits, GitHub Actions logs, ni en campos de variables públicas.

Documentación GitHub: https://docs.github.com/en/rest/actions/workflows y https://docs.github.com/en/rest/actions/artifacts.  
Documentación Cloudflare: https://developers.cloudflare.com/workers/configuration/secrets/

## Código de la prueba

`source-auth-transport.mjs`: rechaza toda URL que no sea una de las cuatro rutas GitHub fijas del run `44976002057` y artefacto `14735612574`, todos los métodos distintos de GET y cualquier body. Ignora por completo el Authorization que agregaría `GitHubOffline` y usa exclusivamente el secreto **separado**. La descarga del ZIP puede responder 302 con URL firmada de GitHub/Azure; la segunda solicitud permite solo hosts de archivado previamente delimitados, es GET, no tiene Authorization ni headers heredados y no permite más redirecciones.

`authenticated-source-proof-lab.mjs`: nuevo recibo durable de un solo uso `buffalo-full-source-auth-44976002057-v1`. Importa los componentes originales del router `handle()`, `GitHubFullSourceProof.verify()` y `D1FullSourceAttestationStore.save()` a través de `env.DB`. No se modifican ni el Handoff V1 ni el código del verificador.

Tiene dos endpoints detrás de **Cloudflare Access**:

- `GET /v1/lab/source/preflight`: consulta autenticada el workflow y ejecuta **el verificador original completo** de run, artefacto ZIP y todos los hashes sobre un SELECT de D1, sin escribir ninguna atestación ni consumir el fence; devuelve solo status y códigos HTTP acotados. No expone respuestas o credenciales crudas.
- `POST /v1/lab/source/verify-once` con body fijo `{"action":"VERIFY_AUTHENTICATED_SOURCE_PROOF_V1"}`: repite el **preflight de evidencia completa** antes de reclamar el fence D1 para **no consumir el único intento por token ausente, HTTP 403, archivo expirado, redirección inválida o hash discrepante**. Luego verifica el run real, ZIP, hash del JSON y manifiesto, persiste mediante el Writer verdadero y comprueba idempotencia y estado original.

El laboratorio se despliega exclusivamente con el binding `DB` a `buffalo-control-plane-race-lab-20261121` (`d1e23807-b076-4c36-8785-7b423fc41614`), sin cron. No se utiliza `GITHUB_FINE_GRAINED_TOKEN` de producción ni `CONTROL_API_TOKEN` real.

### Evidencia / salida

- `source-proof` GitHub real: run `44976002057`, artifact `14735612574`.
- Handoff `6bce82ee-d179-4a2e-9317-f7f4708c5be2` permanece siempre `REGISTERED_UNVERIFIED`, `execution_allowed=0`, `provenance_verified=0` y `github_run_id=NULL`.
- Únicamente si toda la evidencia auténtica coincide y el Worker escribe en D1, el laboratorio termina `PASS`, con **una sola** fila y evento `SOURCE_ATTESTED` en las tablas **separadas** de procedencia.
- Si GitHub/API/ZIP o la escritura falla, mantener `FAIL` o `PRECHECK_BLOCKED`, sin éxito ficticio y sin cambiar recibos anteriores.
- Nunca ejecutar agentes, modelos, PySD, graders ni workflows pagados.

## Protocolo operacional

1. PR y CI con tests negativos de host, método, token, redirecciones sin auth, limitación de metadata e idempotencia.
2. Desplegar nuevo Worker dedicado **sin subdominio público** y con único binding a D1 experimental. Crear app Cloudflare Access con política de miembros de cuenta; verificar `workers.dev=false`, previews=false, schedules=[].
3. El usuario crea PAT fine-grained y lo guarda como secreto mediante Cloudflare dashboard. **La credencial es acción exclusiva del usuario**.
4. Comprobar por API solo la **existencia del nombre del secreto** (no solicitar ni imprimir su valor), habilitar temporalmente URL protegida.
5. Ejecutar preflight GET; solo si devuelve `ready=true` y `status=READY_FULL_EVIDENCE`, lanzar un POST **una sola vez**. Si devuelve error, NO hacer el POST.
6. Verificar con SELECT independiente un `SOURCE_ATTESTED`, su evento, idempotencia y el handoff original.
7. Desactivar URL y previews, comprobar cron[], preservar recibos y revocar el token creado para el laboratorio.

**No desplegar la migración 0004 ni cambios a D1/Worker de producción.** La atestación auténtica de fuentes no equivale a ejecución Merlin ni a una firma SLSA/Sigstore.
