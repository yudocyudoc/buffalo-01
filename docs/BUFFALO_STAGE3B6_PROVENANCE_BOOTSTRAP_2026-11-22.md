# Buffalo 3B-6 · bootstrap del handoff Merlin por commit exacto

Fecha: 2026-11-22. **Solo metadatos, no inferencia, no mutación D1, no despliegue.**

## Motivación

La imagen OCI privada ya estaba publicada para el commit `1c167fcd0a2416450749455689b80dd73e80af3b`. El único handoff fuente previamente atestado en D1 corresponde a `66bee2d96ec71692608fc0829486c2dc130ab7a0`, y es inmutable. Para el primer handshake de la imagen que realmente se despliegue, la nueva declaración y el source-proof GitHub deben corresponder al SHA exacto del runtime.

El verificador original `GitHubFullSourceProof.verify` **exige** que el run de procedencia sea de tipo `workflow_dispatch`, tenga `head_branch=main`, `head_sha=handoff.commit_sha`, `run_attempt=1` y artifact de ZIP y JSON válidos. Ejecutar el archivo `create-source-proof.mjs` en cualquier CI de push no alcanza por sí solo esa condición.

## Diseño

- Nuevo workflow `.github/workflows/buffalo-stage3b6-handoff-bootstrap.yml`. `pull_request`: genera un manifest de prueba solo de metadatos. `push` a `main` por este mismo archivo: genera el manifest **del commit final**, y despacha `buffalo-full-source-proof.yml` por API de GitHub usando `GITHUB_TOKEN` con `actions:write`, preservando el evento `workflow_dispatch` requerido por el verificador existente.
- `handoff_id` fijo, creado para este único bootstrap: `cffb07d9-78b5-464f-8194-3f6ffd144b90`. `agent=merlin`, `case_index=0`, `mode=sfd`.
- Antes del dispatch, otro job reconstruye `manifest_sha256` en GitHub a partir del repositorio original, y se comprueba que `refs/heads/main` **sigue** siendo el mismo commit que realizará el dispatch; si main avanzó, falla cerrado.
- El workflow de imagen privada se activa además cuando cambia este nuevo archivo, de forma que el mismo commit de `main` sea fuente del manifest y de la imagen publicada por digest. Sus pruebas siguen siendo `--network none`, dentro de 256 MiB; no conecta el Container.
- Se guarda artefacto acotado del manifest no ejecutable (7 días); los pasos muestran el digest y los campos del manifest para lectura de auditoría. No contiene secretos, contexto privado ni prompts del benchmark.

GitHub permite que `GITHUB_TOKEN` dispare una ejecución `workflow_dispatch` a pesar de las limitaciones de encadenamiento por eventos del token. La ejecución secundaria sigue su propia política de `contents:read`, sin llamadas a modelos.

## Validación y compuertas posteriores

**NO** declarar `SOURCE_ATTESTED` por el hecho de que el dispatcher haya recibido un HTTP 204. La ejecución secundaria debe terminar **success**, producir exactamente un artifact y superar `GitHubFullSourceProof.verify` con el `handoff_id` y `manifest_sha256` que se hayan guardado en D1.

El siguiente registro en D1 debe pasar por el contrato canónico `normalizeHandoff` / `digestHandoff` / `D1FullHandoffStore.create` y conservar `REGISTERED_UNVERIFIED`, `provenance_verified=0` y `execution_allowed=0`. La atestación posterior debe verificar el run GitHub mediante `FullSourceAttestationService.attest`, no hacerse con una actualización manual de `proof_status`.

Este workflow **no escribe D1** ni configura Workers, Access, service bindings, Container applications o secretos; tampoco concede grants, ejecuta evaluaciones, llama PySD o utiliza Workers AI. Con la imagen y la prueba de fuente únicamente tendremos evidencia suficiente para intentar la admisión de la conexión privada, sujeto a la correcta persistencia D1.
