# Buffalo Full Handoff V1 — Recibo final Worker ↔ D1 (2026-11-21 México / 2026-11-22 UTC)

**Veredicto:** PASS para cuatro compuertas del smoke remoto.  
**Naturaleza:** manifiesto sintético; no ejecución de Buffalo Full ni procedencia GitHub independiente.  
**Código:** PR #27, harness `workers/buffalo-control-plane/full-handoff-lab.mjs`.  
**Cloudflare Worker dedicado:** `buffalo-full-handoff-lab`.  
**D1 laboratorio:** `buffalo-control-plane-race-lab-20261121`, ID `d1e23807-b076-4c36-8785-7b423fc41614`.  
**Identificador del recibo:** `buffalo-full-handoff-worker-binding-v1`.

## Evidencia primaria en D1

Se consultó de forma independiente el registro de la respuesta HTTP del usuario:

```sql
SELECT test_id,status,failure_stage,failure_code,detail_json,created_at,finished_at
FROM buffalo_full_handoff_lab_receipts
WHERE test_id='buffalo-full-handoff-worker-binding-v1';
```

D1 devolvió `PASS`, `failure_stage=NULL`, `failure_code=NULL`, `created_at='2026-11-22 01:17:49'` y `finished_at='2026-11-22 01:17:49'` UTC. El `detail_json` declaró `backend='CLOUDFLARE_WORKER_ENV_DB'` y `subject='SYNTHETIC_DECLARATION_ONLY'`.

| Etapa | Medida observada |
|---|---|
| PARALLEL_ADMISSION | 8 intentos, 1 `201`, 7 `200`, 1 evento |
| READ_AND_CONFLICT | GET `200`, mismo UUID con contenido distinto `409` |
| ROUTE_SEPARATION | `paid` prohibido `400`, ruta de despacho inexistente `404`, entrada por `/v1/tasks` rechazada `400` |
| SQL_IMMUTABILITY | 4 escrituras prohibidas rechazadas por restricciones D1 |

Se verificó separadamente en `buffalo_full_handoffs` un único registro sintético `handoff_id='91000000-0000-4000-8000-000000000201'`, agente `merlin`, escenario `syntheticHandoffLab`, `manifest_sha256='f28a0f92cfe48edfa3016d6b19434ea4b44382945671d1a7cfdc7905a77a78fa'`. Sus campos permanecen `state='REGISTERED_UNVERIFIED'`, `execution_allowed=0`, `provenance_verified=0`, `github_run_id=NULL`. La tabla `buffalo_full_handoff_events` contiene exactamente un `DECLARATION_ADMITTED` para este UUID, con el mismo SHA, `event_id=2`. El número global del evento no es un indicador de cantidad de eventos de esta declaración.

El harness declara contadores `provider_requests=0`, `github_requests=0`, `simulation_requests=0`, `agent_requests=0`; estos son indicadores de flujo del propio código, **no una auditoría independiente de egress de red**. Por diseño el harness no recibe credenciales de proveedores ni GitHub, y llama a `handle()` usando objetos de dependencias inertes.

## Cierre seguro verificado

Después de leer D1 y sin repetir el POST:

- Se solicitó deshabilitar `workers.dev` y previews en `buffalo-full-handoff-lab`.
- GET de configuración confirmó `subdomain.enabled=false` y `previews_enabled=false`.
- GET de schedules confirmó `[]` (sin cron).
- El Worker mantiene solo `DB` enlazado a la D1 aislada; **no está desplegado sobre la D1 productiva**.

La tarea original de producción `d3af46b3-01ce-4c28-ba24-31d52a908464` fue verificada `SUCCEEDED`, `github_run_id=44956533083`, `github_artifact_id=14728065888`, `result_sha256=57088281d3b355ec619bfd8d4703a3c27f776a63b424673abaf9e83bd0393b7d`.

## Interpretación y siguiente compuerta

**Demostrado:** la ruta HTTP auténtica de handoff, su `D1FullHandoffStore` original y las restricciones en `env.DB` real administran correctamente la admisión concurrente, deduplicación por UUID, respuesta de conflicto y prohibiciones de ejecución **en los casos acotados del laboratorio**.

**No demostrado:** firma de procedencia GitHub, correspondencia entre commit declarado y fuentes auténticas, ni ejecución de Merlin, Sócrates, Themis o Athena; tampoco garantías universales bajo particiones de red o cargas ilimitadas.

**Siguiente paso:** implementar una atestación independiente de GitHub Actions vinculada a identidad de workflow, commit, casos dev y SHA del manifiesto; mantener el registro de handoff como `REGISTERED_UNVERIFIED` hasta que un verificador nuevo valide la evidencia. Cualquier futura transición de procedencia requiere contrato y migración versionados separados, nunca inferencia directa de un hash suministrado.

El PR #27 contiene el plan técnico de la prueba: `docs/BUFFALO_FULL_HANDOFF_WORKER_D1_SMOKE_PLAN_2026-11-21.md`. Este recibo es la confirmación posterior.
