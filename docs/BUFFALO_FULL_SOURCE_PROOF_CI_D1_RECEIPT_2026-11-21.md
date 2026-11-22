# Buffalo Full · Procedencia GitHub — Recibo de código y preparación del primer smoke

**Corte:** 2026-11-21 México / 2026-11-22 UTC.

## Trabajo completado

PR #29 integrado en `main`, commit `b55f9a7b94a038cc73a08b4238ee9742ea107f96`. Contiene:

- Workflow manual `.github/workflows/buffalo-full-source-proof.yml` de metadata-only y sin credenciales de inferencia.
- Productor `create-source-proof.mjs` que rederiva los hashes de fuente, agente y escenario real de desarrollo a partir de un checkout de commit fijado y falla si el SHA global no coincide.
- Verificador GitHub GET-only (`full-provenance-github.mjs`) para workflow ID/ruta, run ID, commit, rama, título, evento, intento, éxito, ZIP único, digest externo, miembro ZIP/CRC y esquema interno cerrado.
- API declarativa de consulta y verificación separada de `/dispatch`, cuyo resultado se guarda en nuevas tablas de fuente.
- Migración `0004_full_source_attestations.sql`: evidencias y eventos separados del handoff original, con IDs únicos, FK, prohibición de ejecución y triggers de inmutabilidad.

## Comprobaciones de GitHub CI

Para el commit de PR `50c7dacfe44d7c02c39b4636c638936a119eb26a`, completaron satisfactoriamente:

- `Buffalo Worker/D1/GitHub offline contracts (no API)`: 2 pruebas de lab, 6 de source gate, 9 de procedencia, 6 del handoff, 31 del control plane: **54/54 pruebas Node**.
- `test-sql-offline.py`, `test-handoff-sql.py` y `test-source-provenance-sql.py`: PASS.
- `full-handoff-source-snapshot`: genera metadata del escenario real DEV `dialysisClinic` para Merlin, Socrates, Themis y Athena, y genera un JSON de prueba de fuentes coherente para Merlin.
- `Buffalo control-plane contract (offline)`, `Go`, `Run Unit Tests`: PASS.

El resultado de CI valida el productor y el verificador mediante mocks y metadatos reales, **no prueba todavía un workflow_dispatch del nuevo workflow contra una declaración almacenada**.

## Comprobaciones reales de Cloudflare D1

La migración 0004 se aplicó mediante API D1 solamente a la base aislada `buffalo-control-plane-race-lab-20261121`, ID `d1e23807-b076-4c36-8785-7b423fc41614`.

Las siete sentencias de migración respondieron `success=true`:

- Tabla `buffalo_full_source_attestations`.
- Tabla `buffalo_full_source_events`.
- Índice de eventos.
- Cuatro triggers no-update/no-delete para evidencia y auditoría.

Posterior `SELECT COUNT(*)` sobre `buffalo_full_source_attestations`: **0**. No se fabricó ninguna atestación positiva.

La base de producción `buffalo-control-plane-offline` **no** recibió 0004; su tarea real `d3af46b3-01ce-4c28-ba24-31d52a908464` permaneció `SUCCEEDED`, run `44956533083` y artefacto `14728065888`.

## Próxima prueba: fuente auténtica, no sintética

La siguiente compuerta debe seguir esta secuencia, sin reutilizar el UUID sintético:

1. Elegir un nuevo UUID y un commit `main` exacto, inmóvil mientras se prepara el manifiesto.
2. Preparar el manifiesto de Merlin para caso DEV `case_index=0` a partir de ese mismo commit, usando `node scripts/full-integration/prepare-handoff.mjs`. Leer solamente el objeto `manifest`, no enviar envolturas de diagnóstico.
3. Registrar ese manifiesto en D1 de laboratorio bajo la API de admisión controlada, nunca en producción. Confirmar `REGISTERED_UNVERIFIED`, SHA global, un solo evento.
4. Iniciar **una vez** `buffalo-full-source-proof.yml` manualmente sobre `main` con ID, agente, `case_index` y `manifest_sha256`. La confirmación de que se envió no equivale a evidencia final.
5. Cuando termine, comprobar run real, commit, workflow ID, ZIP y hashes; registrar fuente solo si todo coincide. Verificar directamente D1 una única atestación `SOURCE_ATTESTED`, y que la declaración siga `REGISTERED_UNVERIFIED`, `execution_allowed=0`.
6. Probar negativos sin reemitir ejecución pagada: digest alterado, run no correspondiente y ZIP incompatible.
7. Desactivar cualquier endpoint de laboratorio y conservar recibos.

**Importante:** La API de GitHub no equivale a firma independiente SLSA/Sigstore. La confianza incluye el código que GitHub ejecutó y los permisos del repositorio. No hay un resultado de comportamiento de agente ni autorización de gasto. La URL del Worker productivo y su D1 no se deben utilizar para el smoke de 0004.

## Ejemplo de preparación local en PowerShell

Ejecutar **dentro de una copia local actualizada del repo**, con Node y dependencias instalados. El comando crea metadatos; no llama a proveedores ni a GitHub:

```powershell
git switch main
git pull --ff-only
npm ci --ignore-scripts
$handoffId = [guid]::NewGuid().ToString()
$headSha = (git rev-parse HEAD).Trim()
node scripts/full-integration/prepare-handoff.mjs --handoff-id $handoffId --agent merlin --case-index 0 --commit $headSha | Set-Content -Encoding utf8 buffalo-source-handoff.json
$prepared = Get-Content buffalo-source-handoff.json -Raw | ConvertFrom-Json
$prepared.manifest | ConvertTo-Json -Depth 8
$prepared.manifest_sha256
```

No enviar tokens ni archivos de configuración secretos. Si `main` cambia después de esta preparación, el workflow manual disparado contra un nuevo commit no corresponde al manifiesto y **debe fallar**, no se debe reinterpretar como éxito. Se requiere generar un manifiesto nuevo con el nuevo SHA.

**Estado de esta etapa:** implementación + CI PASS, SQL D1 real preparado, run GH positivo **pendiente** y Worker de verificación en laboratorio **sin desplegar**.
