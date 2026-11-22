# Buffalo Full — fallo acotado de primera verificación de procedencia, run 44976002057

**Corte:** 2026-11-21 México / 2026-11-22 UTC.  
**Veredicto:** FAIL, sin atestación positiva y con fail-closed verificado.

## Evidencia primaria de Cloudflare D1

Worker aislado de origen: `buffalo-real-source-proof-lab`.  
D1 exclusivamente experimental: `d1e23807-b076-4c36-8785-7b423fc41614`.  
Recibo: `buffalo-full-source-real-44976002057-v1`.

Consulta de D1 posterior a la respuesta HTTP del usuario:

- `status='FAIL'`
- `failure_stage='VERIFY_AND_PERSIST'`
- `failure_code='SOURCE_REAL_LAB_FIRST_ATTESTATION_REJECTED'`
- `created_at=finished_at='2026-11-22 02:39:28'` UTC.
- `CHECK_BEFORE='PASS'`.
- `github_requests=1`, `github_post_requests=0`, `provider_requests=0`, `agent_requests=0`. Son contadores del propio harness, no observabilidad independiente del transporte.
- No se creó registro alguno en `buffalo_full_source_attestations` ni evento en `buffalo_full_source_events` para `6bce82ee-d179-4a2e-9317-f7f4708c5be2`.
- La declaración continúa `REGISTERED_UNVERIFIED`, `execution_allowed=0`, `provenance_verified=0` y `github_run_id=NULL`.

El endpoint temporal del Worker fallido se deshabilitó; GET verificó `workers.dev.enabled=false` y `previews_enabled=false`; no tenía cron activo (`schedules=[]`).

## Interpretación restringida

Se inició **una sola** consulta GitHub, mientras la verificación positiva requiere cuatro GET: identificación del workflow, metadatos del run, catálogo de artefactos y ZIP. Por tanto el fallo ocurrió en el primer GET a `/actions/workflows/buffalo-full-source-proof.yml` o en la comprobación inmediata de su respuesta. El código de servicio oculta deliberadamente el error upstream y retorna `SOURCE_PROOF_NOT_VERIFIED`; el laboratorio solo registró `FIRST_ATTESTATION_REJECTED`.

**No sabemos aún** si la causa fue HTTP 401/403/404/429, restricción de red o identidad inesperada. No atribuir el fallo al ZIP, D1 o al contenido del manifiesto sin evidencia. El artefacto de GitHub fue descargado y revisado independientemente en el recibo PR #32, pero aquella prueba no equivale a ejecutar el verificador del Worker.

## Diagnóstico preparado sin repetir el ensayo fallido

PR #34 añade `workers/buffalo-control-plane/source-first-get-diagnostic.mjs`. Se despliega como Worker **distinto**, `buffalo-source-get-diagnostic-lab`, accesible solamente tras Cloudflare Access, con único binding D1 de laboratorio, sin cron ni secretos. La sonda realiza **un solo GET público, sin bearer**, únicamente al endpoint GitHub del workflow; guarda un código normalizado (`HTTP_403`, `HTTP_404`, `NETWORK_TYPE_ERROR`, `GITHUB_WORKFLOW_OK`, etc.), código HTTP y coincidencia de identidad, sin copiar cuerpos ni headers sensibles.

Nuevo recibo inmutable de un solo uso: `buffalo-source-workflow-first-get-diagnostic-v1`. Su endpoint externo `POST /v1/lab/github-first-get` solo admite el cuerpo literal `{"action":"DIAGNOSE_GITHUB_WORKFLOW_GET_V1"}`. **Nunca** invoca `verify-source`, no escribe `SOURCE_ATTESTED` y no vuelve a usar el ID del ensayo fallido.

**Criterio de continuación:** cuando se obtenga la categoría concreta, elegir una reparación acotada y validarla con tests negativos; cualquier ensayo posterior de fuente debe tener un nuevo identificador y conservar el recibo `FAIL` original. No se autoriza token con permisos de escritura ni traslado de secretos productivos sin evaluación explícita.

## Producción

Sin cambios de Worker, tokens ni D1 productiva. La tarea histórica original `d3af46b3-01ce-4c28-ba24-31d52a908464` sigue en `SUCCEEDED` conforme a las comprobaciones anteriores.
