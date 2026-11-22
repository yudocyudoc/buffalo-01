# Preparar Buffalo Full sin copia local — GitHub Actions

**Motivo:** no es necesario clonar el repositorio ni instalar Node, Git o npm en el equipo del usuario. El manifiesto de handoff se genera en una ejecución manual de GitHub Actions, sobre el commit fijado de `main`.

**Workflow:** `.github/workflows/buffalo-full-prepare-handoff.yml`.

## Procedimiento web

1. Abrir GitHub → repositorio `yudocyudoc/buffalo-01` → **Actions** → **Prepare Buffalo Full handoff (metadata only, no AI)**.
2. Elegir **Run workflow**, branch `main`, agente `merlin`, `case_index=0`.
3. Esperar conclusión **success**. Abrir el run → **Summary**. Copiar el JSON que comienza con `manifest` y contiene `manifest_sha256`; alternativamente descargar su artifact de 7 días. También aparece en logs como `BUFFALO_HANDOFF_PREPARED_JSON=`.
4. Compartir solo ese JSON o el URL del run para validación. Nunca compartir tokens. El flujo no ejecuta agentes ni proveedores.
5. Registrar el `manifest` en una D1 de laboratorio, no producción, y conservar `manifest_sha256`. Para probar procedencia, el siguiente workflow `buffalo-full-source-proof.yml` deberá lanzarse mientras el SHA de `main` sea exactamente el del manifiesto. Si `main` avanzó, preparar un manifiesto nuevo.

## Qué demuestra y qué no

El resultado es un **manifiesto auténticamente preparado por GitHub Actions** desde archivos de `main` y el caso DEV que el preparador original lee. Incluye hashes, UUID, identidad de agente y commit. **No** es todavía una atestación verificada por la API de GitHub del segundo workflow ni prueba de benchmark/LLM/PySD.

El script exige `SOURCE_READ_ONLY`, `execution=NOT_EXECUTED`, `provenance=DECLARED_UNVERIFIED`, y compara `commit_sha` con el `GITHUB_SHA` del checkout. No pasa cuerpo alguno a proveedores ni toca Cloudflare D1. Su único permiso de GitHub es `contents: read`, y la subida de artifact tiene retención de siete días.

**Secuencia:** preparar en Actions → recuperar JSON → admitir solo en D1 experimental → despachar una sola prueba de fuente en Actions → verificar su evidencia en el Worker experimental → conservar recibo y apagar endpoint. Separar cada compuerta.
