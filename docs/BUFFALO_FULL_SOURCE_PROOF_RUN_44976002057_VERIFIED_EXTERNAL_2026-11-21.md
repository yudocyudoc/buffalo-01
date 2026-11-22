# Buffalo Full — recibo de fuente GitHub real, run 44976002057

**Corte:** 2026-11-21 (México) / 2026-11-22 UTC.  
**Resultado:** **evidencia de GitHub y ZIP verificada externamente**; **persistencia `SOURCE_ATTESTED` en D1 aún pendiente**.  
**Nivel de ejecución:** metadatos; no se ejecutó Merlin, modelos, grader ni PySD.

## Declaración de origen

El manifiesto `BUFFALO_FULL_HANDOFF_V1` de GitHub Actions y D1 laboratorio identificaba:

- `handoff_id`: `6bce82ee-d179-4a2e-9317-f7f4708c5be2`
- agente: `merlin`, benchmark: `policyImplementation`, escenario: `dialysisClinic`, `case_index=0`, `mode=sfd`
- `commit_sha`: `66bee2d96ec71692608fc0829486c2dc130ab7a0`
- `manifest_sha256`: `462b4fbb820c5813ce9087af827b667a01855a63a0f2ab1498df4d3145650f05`
- estado original en D1: `REGISTERED_UNVERIFIED`, ejecución permitida `0`, procedencia en el registro original `0`, sin run asociado.

## Procedencia de GitHub verificada

La API autenticada mediante el conector GitHub devolvió para [run #44976002057](https://github.com/yudocyudoc/buffalo-01/actions/runs/44976002057):

| Condición | Evidencia |
|---|---|
| Evento | `workflow_dispatch` |
| Workflow | `.github/workflows/buffalo-full-source-proof.yml`, workflow ID `426442743` |
| Repositorio y head repo | `yudocyudoc/buffalo-01` |
| Rama/commit | `main` / `66bee2d96ec71692608fc0829486c2dc130ab7a0` |
| Run exacto | `44976002057`, attempt `1`, título `Buffalo full source proof 6bce82ee-d179-4a2e-9317-f7f4708c5be2` |
| Estado | `completed`, `success` |
| Timestamp de creación | `2026-11-22T02:25:16Z` |
| Artifacts por API, total_count | `1` |
| Artifact | `14735612574`, nombre `buffalo-full-source-6bce82ee-d179-4a2e-9317-f7f4708c5be2`, no expirado |
| Tamaño ZIP | `1152` bytes |
| SHA-256 del ZIP | `e881bb34dac811b06bc0f43c2119c412d8b9e94b129d85191eb9d339488c9157` |

La descarga autenticada del ZIP con el conector GitHub coincidió byte a byte con el digest reportado por GitHub. El archivo tiene un solo miembro `buffalo-full-source-proof.json`, sin compresión, longitud `978` bytes, CRC válido. SHA-256 del miembro: `9f200cdc0723ac39b8690453892b51801563133f39c4ee4f1d8a461987d75e7d`. Este SHA de **contenido JSON** no es el mismo que el SHA del ZIP; ambos están comprobados.

El JSON coincidió de forma exacta con los 17 campos requeridos por `BUFFALO_FULL_SOURCE_PROOF_V1`, incluyendo identidad, agente, caso, huellas del origen, `manifest_sha256` y `evidence.kind=GITHUB_SOURCE_METADATA_ONLY`. Se reconstruyó y volvió a calcular el SHA-256 canónico del manifiesto desde los campos persistidos: `462b4fbb820c5813ce9087af827b667a01855a63a0f2ab1498df4d3145650f05`.

El job `derive-source-only` de GitHub concluyó exitosamente; todas las etapas de checkout, gate de fuentes, instalación con `--ignore-scripts`, generación de prueba y carga del único ZIP reportaron éxito.

## Estado D1 verificado tras la inspección

Base **aislada**: `buffalo-control-plane-race-lab-20261121`, ID `d1e23807-b076-4c36-8785-7b423fc41614`.

- En `buffalo_full_handoffs`, el manifiesto de `6bce82ee-d179-4a2e-9317-f7f4708c5be2` continuó intacto como `REGISTERED_UNVERIFIED`, `execution_allowed=0`, `provenance_verified=0`, `github_run_id=NULL`.
- Existe exactamente un evento `DECLARATION_ADMITTED` vinculado a ese ID.
- En `buffalo_full_source_attestations`, **cero** filas para ese ID.

**No se escribió `SOURCE_ATTESTED` mediante API D1 administrativa**, porque ello eludiría `GitHubFullSourceProof.verify()` + `D1FullSourceAttestationStore.save()` del Worker y su evento atribuido a `WORKER_GITHUB_SOURCE_V1`. El resultado de este recibo es una **inspección real independiente** de GitHub y el artefacto, **no** una confirmación de que el pipeline de verificación del Worker se ejecutó.

Se consultó la D1 de producción por separado; la tarea histórica `d3af46b3-01ce-4c28-ba24-31d52a908464` permanece `SUCCEEDED` con run `44956533083` y artifact `14728065888`.

## Compuerta que falta

Desplegar **exclusivamente en laboratorio** el verificador real de fuentes, con acceso limitado a GitHub API y binding a D1 experimental, y ejecutar una única verificación autorizada de `github_run_id=44976002057` para el handoff anterior. Confirmar mediante SELECT en D1:

1. Una fila `BUFFALO_FULL_SOURCE_PROOF_V1` con `SOURCE_ATTESTED` y los identificadores/digests observados.
2. Un solo evento `SOURCE_ATTESTED` escrito por el Worker.
3. Declaración original todavía `REGISTERED_UNVERIFIED`, sin ejecución autorizada.
4. Endpoint de laboratorio desactivado tras la prueba.

No reutilizar el secreto de producción en otro script sin controles ni simular un actor Worker mediante una inserción administrativa. **Esta última compuerta permanece pendiente**, aunque la evidencia remota observada sea coherente.

## Alcance epistemológico

La evidencia verifica que GitHub Actions produjo un archivo de metadatos coherente con el código y el commit declarado, bajo confianza en GitHub y el productor del repositorio; **no** equivale a una firma criptográfica SLSA/Sigstore, ni acredita evaluación de calidad o inferencia del agente.
