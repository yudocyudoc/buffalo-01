# Buffalo Full — Primer SOURCE_ATTESTED real mediante GitHub → Worker → D1

**Corte:** 2026-11-21 (Ciudad de México) / 2026-11-22 UTC.

**Veredicto:** **PASS**, atestación de procedencia de fuentes verificada y persistida mediante el **Worker real**, con evento independiente. **No implica ejecución del agente ni permiso de inferencia.**

## Evidencia primaria

**Repositorio:** `yudocyudoc/buffalo-01`.  
**Handoff:** `6bce82ee-d179-4a2e-9317-f7f4708c5be2`.  
**Agente y benchmark:** `merlin`, `policyImplementation`, escenario DEV `dialysisClinic`, `case_index=0`, `mode=sfd`.  
**Commit declarado y contrastado:** `66bee2d96ec71692608fc0829486c2dc130ab7a0`.  
**Manifest digest:** `462b4fbb820c5813ce9087af827b667a01855a63a0f2ab1498df4d3145650f05`.

### GitHub

| Identidad | Valor observado |
|---|---|
| Workflow | `buffalo-full-source-proof.yml` |
| Workflow ID | `426442743` |
| Run (workflow_dispatch) | `44976002057` |
| Artifact | `14735612574` |
| SHA-256 del ZIP | `e881bb34dac811b06bc0f43c2119c412d8b9e94b129d85191eb9d339488c9157` |
| SHA-256 del contenido JSON | `9f200cdc0723ac39b8690453892b51801563133f39c4ee4f1d8a461987d75e7d` |

El preflight **de evidencia completa** en el Worker, con credencial de alcance `Actions: Read-only` dedicada, respondió `ready=true`, `status=READY_FULL_EVIDENCE`. Observó:

- `REPO_WORKFLOW` HTTP 200 (dos veces, por preflight primario y verificador).
- `REPO_RUN` HTTP 200.
- `REPO_ARTIFACTS` HTTP 200.
- `REPO_ZIP` HTTP 302 a enlace firmado temporal.
- `SIGNED_ZIP_DOWNLOAD` HTTP 200, sin reenviar la credencial al host de descarga.
- `x-ratelimit-remaining` pasó de 4999 a 4995 en la captura del preflight; son valores de cabecera de esa operación, no garantía de disponibilidad futura.

Estos pasos verificaron run, workflow, ZIP, CRC, hashes y concordancia del manifiesto antes de reclamar el registro de un solo uso.

### Cloudflare Worker → D1

**Worker aislado:** `buffalo-auth-source-proof-lab`.  
**Base aislada:** `buffalo-control-plane-race-lab-20261121`, ID `d1e23807-b076-4c36-8785-7b423fc41614`.  
**Recibo de ejecución:** `buffalo-full-source-auth-44976002057-v1`.

La persona usuaria ejecutó **un único POST autenticado** y obtuvo `status=PASS`, etapas:

1. `PRECHECK_HANDOFF`: PASS.
2. `VERIFY_AND_PERSIST`: PASS. Run `44976002057`, artefacto `14735612574`, eventos `1`.
3. `IDEMPOTENCY_AND_IMMUTABILITY`: PASS. La segunda llamada interna devolvió comportamiento idempotente; run distinto rechazado; declaración original preservada.

**Verificación posterior independiente mediante Cloudflare D1 API** (no basada solamente en el JSON del HTTP):

- `buffalo_full_source_lab_receipts`: una fila para `buffalo-full-source-auth-44976002057-v1`, `status='PASS'`, `failure_stage=NULL`, `failure_code=NULL`, `created_at='2026-11-22 04:09:06'`, `finished_at='2026-11-22 04:09:08'` UTC.
- `buffalo_full_source_attestations`: una fila para el handoff, `proof_schema='BUFFALO_FULL_SOURCE_PROOF_V1'`, `proof_status='SOURCE_ATTESTED'`, `repo='yudocyudoc/buffalo-01'`, workflow ID `426442743`, GitHub run `44976002057`, artifact `14735612574`, todos los SHA idénticos a los valores anteriores, `execution_allowed=0`. Fecha de creación `2026-11-22 04:09:07` UTC.
- `buffalo_full_source_events`: exactamente **un** evento `SOURCE_ATTESTED`, `event_id=1`, `actor='WORKER_GITHUB_SOURCE_V1'`, `evidence_sha256='9f200cdc0723ac39b8690453892b51801563133f39c4ee4f1d8a461987d75e7d'`, creado `2026-11-22 04:09:07` UTC.
- `buffalo_full_handoffs`: `REGISTERED_UNVERIFIED`, `execution_allowed=0`, `provenance_verified=0`, `github_run_id=NULL`. El nombre de estado del handoff **no** cambia: la procedencia acreditada se conserva exclusivamente en tabla de atestaciones separada.
- Recibos anteriores preservados: `buffalo-full-source-real-44976002057-v1` → `FAIL / SOURCE_REAL_LAB_FIRST_ATTESTATION_REJECTED`; `buffalo-source-workflow-first-get-diagnostic-v1` → `FAIL / HTTP_403`. El paso a credencial de solo lectura reparó la causa de acceso observada; no se reescribió la historia.

## Cierre operativo de seguridad

Después de la comprobación D1, se solicitó apagar la URL temporal `workers.dev` y previews del Worker `buffalo-auth-source-proof-lab`. GET de Cloudflare confirmó:

- `subdomain.enabled=false`.
- `previews_enabled=false`.
- `schedules=[]` (sin cron).
- Binding `DB` solo al D1 de laboratorio.
- Binding secreto `GITHUB_SOURCE_READ_TOKEN` **sigue presente**, sin exponer su valor. **Acción posterior del titular:** revocar el token de GitHub temporal y opcionalmente eliminar el secreto de Cloudflare; no asumir que quedó revocado por apagar el subdominio.

Producción original, comprobada directamente antes del apagado: tarea `d3af46b3-01ce-4c28-ba24-31d52a908464` sigue `SUCCEEDED`, run `44956533083`, artifact `14728065888`, digest de resultado `57088281d3b355ec619bfd8d4703a3c27f776a63b424673abaf9e83bd0393b7d`.

## Qué queda demostrado

**Demostrado en este caso concreto:** El Worker obtuvo evidencia auténtica de GitHub por API autenticada de lectura, verificó run/commit/archivo/hashes, escribió por su servicio original una sola atestación y evento en D1 real, demostró idempotencia y conservó prohibida la ejecución. No hay atestación positiva simulada mediante inserción administrativa.

**No demostrado:** Firma criptográfica independiente estilo Sigstore/SLSA, generalización a más agentes/casos/commits, ejecución de Merlin o cualquier otro agente, evaluación de graders/PySD, eficacia de modelos, ni ejecución pagada. Los contadores del harness `provider_requests=0` / `agent_requests=0` reflejan su diseño y flujo, no una auditoría independiente de egress.

## Siguiente compuerta sugerida

**Etapa 3:** un dry run del *orquestador original* en modo de simulación local y **sin proveedor**, con inputs declarados e invariantes de no inferencia. Diseñar antes el contrato de evidencia de salida: esta atestación de procedencia no puede utilizarse como autorización implícita para ejecutar modelos o alterar la tarea original.

Referencias técnicas: PR #25 (source gate), #26 (handoff), #27–28 (Worker/D1 smoke), #29–32 (procedencia y verificación externa), #33–35 (laboratorio y fallos preservados), #36 (transporte autenticado seguro).
