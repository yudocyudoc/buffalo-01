# Buffalo Full — etapa 2.5: procedencia de fuentes vía GitHub Actions (sin ejecución de agentes)

**Fecha:** 2026-11-21 (México). **Estado del PR:** implementar + pasar CI antes de merge. **La prueba real workflow_dispatch y el deploy de Worker/D1 están pendientes.**

## Motivación y fronteras

La etapa 2 y su smoke remoto demostraron admisión y bloqueo de un manifiesto sintético en Worker→D1. Sin embargo, hashes y `commit_sha` aportados por el solicitante pueden mentir. Necesitamos evidencia adicional **obtenida por GitHub API**, no interpretar un hash autodeclarado como una atestación.

No se alteran `buffalo_tasks`, `BUFFALO_OFFLINE_ECHO_V1`, `buffalo_full_handoffs` ni las restricciones `REGISTERED_UNVERIFIED / execution_allowed=0 / provenance_verified=0 / github_run_id=NULL`. Se crea una **tabla separada** `buffalo_full_source_attestations` con un estado distinto `SOURCE_ATTESTED`, exclusivamente de *procedencia de código fuente*; NO indica que un agente o benchmark se haya ejecutado.

## Productor: un workflow manual nuevo y exclusivo

`.github/workflows/buffalo-full-source-proof.yml`: `workflow_dispatch` únicamente, con `handoff_id`, `agent`, `case_index` y `manifest_sha256`. Se ejecuta sobre `main` y checkout del SHA inmutable del run, `permissions: contents: read`, `persist-credentials: false`, `npm ci --ignore-scripts`, sin referencias a secretos de inferencia, ni `runAgent`, ni `evaluate`, ni PySD.

El productor `scripts/full-integration/create-source-proof.mjs` calcula nuevamente el manifiesto utilizando `inspectOriginalSources()` y el caso **dev** real `policyImplementation`. Si el SHA del manifiesto difiere del declarado, termina sin artefacto.

Tras éxito produce **un solo ZIP** con un solo miembro JSON `buffalo-full-source-proof.json`, artefacto `buffalo-full-source-{handoff_id}`, sin contenido de prompts o modelos, retención 7 días.

## Verificador: GitHub como fuente independiente del solicitante

`GitHubFullSourceProof.verify()` usa únicamente métodos `GET` de la API autenticada de GitHub, nunca `POST /dispatches`. Exige:

1. Workflow existente en ruta exacta `.github/workflows/buffalo-full-source-proof.yml` y workflow ID correspondiente al run.
2. Run exacto solicitado, evento `workflow_dispatch`, rama `main`, head SHA igual al `commit_sha` registrado, repositorio base y head igual a `yudocyudoc/buffalo-01`, título `Buffalo full source proof {handoff_id}`, `run_attempt=1`, estado completed/success y timestamp válido.
3. Exactamente un artefacto no expirado con nombre vinculado a UUID, ZIP de tamaño acotado y digest SHA-256 comprobado frente a los bytes descargados de GitHub.
4. Un solo miembro `buffalo-full-source-proof.json`, ZIP estructuralmente válido y CRC correcto, JSON válido con esquema **cerrado**: los hashes internos, ID, agente, benchmark, escenario, caso, workflow y commit deben coincidir **exactamente** con el handoff almacenado; el digest del manifiesto se recalcula desde sus campos D1.
5. Cualquier discrepancia, fallo HTTP, run inconcluso, rerun o ZIP ilegible → **sin atestación positiva**. No se devuelven al usuario mensajes del upstream.

## Persistencia y API

Migración `0004_full_source_attestations.sql`: dos tablas separadas `buffalo_full_source_attestations` y `buffalo_full_source_events`; unicidad por handoff/run/artefacto, evento único por inserción mediante `changes()=1`, FK al handoff, inmutabilidad explícita de filas y eventos con triggers `UPDATE/DELETE → RAISE(ABORT)`. El SHA del artefacto y SHA del JSON se guardan junto al run, workflow, commit, manifiesto y timestamp.

Rutas autenticadas nuevas en el Worker:
- `POST /v1/full/handoffs/{id}/verify-source` con **solo** `{"github_run_id":123}`: consulta y valida GitHub, y únicamente después escribe la atestación. `201` al registrar, `200` si ya existe la misma, `409` para conflictos o evidencia no válida. No dispara ningún workflow.
- `GET /v1/full/handoffs/{id}/source-proof`: muestra el recibo existente o `attested:false`. No cambia estado.

No hay rutas pagadas ni cambios a `paid-agent-case.yml`.

## Amenazas y limitaciones epistemológicas

- **Autenticación no es firma criptográfica:** los resultados se verifican contra HTTPS/API autenticada de GitHub, identidad del run y digest del ZIP; no hay firma Sigstore/SLSA ni otra firma con confianza externa. La confianza incluye GitHub Actions y el código de productor del commit.
- La verificación muestra que un workflow de ese repositorio **produjo un artefacto coherente con el handoff**, no que el workflow fuese incorruptible, ni prueba de exactitud semántica del benchmark. El digest del manifiesto vincula afirmaciones; el proceso de producción y su código son supuestos de confianza, que deberán endurecerse en una futura atestación firmada o reproducible independiente.
- No previene que un actor autorizado cree múltiples runs diferentes para diferentes UUID. El almacenaje impide **dos pruebas positivas sobre un mismo handoff** y un mismo run/artefacto asociado a handoffs distintos; no existe garantía universal «exactly once» de GitHub.
- No se extienden permisos del Worker para ejecutar comandos. El nuevo `SOURCE_ATTESTED` **nunca** autoriza ejecución pagada ni cambia `REGISTERED_UNVERIFIED`.

## Evidencia exigida antes de cerrar la compuerta

1. CI verde en PR: pruebas positivas y negativas de identidad de GitHub, carreras, corrupción ZIP/JSON, verificación de manifiesto, regresión del V1 y nuevas restricciones SQLite 0004.
2. Aplicar 0004 a una D1 **de laboratorio**, no producción.
3. Registrar un handoff **derivado de un caso real** y generar en GitHub una ejecución manual del nuevo workflow contra el mismo commit; verificar run/artifact y escritura vía **Worker de laboratorio**.
4. Comprobar D1 directamente y eliminar URL temporal tras la prueba.

Hasta que 2–4 ocurran, los tests de mocks y CI demuestran la estructura y el productor de metadatos, **no una procedencia GitHub remota positiva**.

## Operación futura (no ejecutar hasta disponer de manifiesto genuino)

Para un handoff registrado de dev, preparar manifiesto sobre el **mismo commit** y ejecutar desde GitHub Actions `buffalo-full-source-proof.yml` en `main`, proporcionando el ID, agente, índice y SHA del manifiesto. Cuando el run resulte exitoso, llamar a `verify-source` con su run ID. Nunca usar un escenario sintético como prueba de procedencia del benchmark real. Si el run falla por SHA diferente, no debe forzarse un estado positivo: se requiere un handoff nuevo correspondiente al commit correcto.

**Secuencia recomendada:** PR + CI → laboratorio con D1 aislada → una prueba real de GitHub sin inferencia → recibo de evidencia → cierre → solo entonces smoke de orquestación sin proveedor.
