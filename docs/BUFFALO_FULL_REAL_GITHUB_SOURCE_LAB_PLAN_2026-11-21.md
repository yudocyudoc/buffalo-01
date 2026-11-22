# Buffalo Full · Laboratorio real de procedencia GitHub → Worker → D1

Fecha: 2026-11-21 México / 2026-11-22 UTC.

## Compromiso de la prueba

Cerrar la última compuerta de la etapa 2.5 con el **verificador original real** dentro de un Worker Cloudflare aislado. La evidencia pertenece al workflow GitHub existente y se almacenará con la implementación D1 de `D1FullSourceAttestationStore`, no mediante una escritura administrativa que simule al Worker.

**Run fijo:** `44976002057`. **Handoff fijo:** `6bce82ee-d179-4a2e-9317-f7f4708c5be2`. El ZIP tiene artifact ID `14735612574`, hash externo `e881bb34dac811b06bc0f43c2119c412d8b9e94b129d85191eb9d339488c9157` y hash JSON `9f200cdc0723ac39b8690453892b51801563133f39c4ee4f1d8a461987d75e7d`. El manifiesto ha sido registrado en D1 aislada con digest `462b4fbb820c5813ce9087af827b667a01855a63a0f2ab1498df4d3145650f05`.

## Arquitectura de ejecución

`real-source-proof-lab.mjs` importa `handle()` (router original), `GitHubFullSourceProof`, `D1FullHandoffStore`, `D1FullSourceAttestationStore` y `FullSourceAttestationService`. Envía **internamente** un POST al router de `verify-source`, pero nunca acepta un run arbitrario ni crea una ruta pública de despacho de GitHub. El único cuerpo HTTP externo admitido es:

```json
{"action":"VERIFY_REAL_SOURCE_PROOF_V1"}
```

Cloudflare Access debe proteger `POST /v1/lab/source/verify-once`; el propio Worker también exige la aserción de Access y rechaza todas las demás rutas. No utiliza cron. La tabla `buffalo_full_source_lab_receipts` en D1 laboratorio conserva un `RUNNING`, `PASS` o `FAIL` único; cualquier repetición devuelve `ALREADY_STARTED`.

Como `yudocyudoc/buffalo-01` es un repositorio público, el transporte del laboratorio hace **solo GET públicos de GitHub**, sin bearer, solo a cuatro URLs fijas bajo `api.github.com/repos/yudocyudoc/buffalo-01/actions`. Se descarta deliberadamente el header Authorization que generaría la biblioteca original. El resto del verificador original comprueba identidad del workflow, run, ZIP, CRC, digest y contenido. **No se copia el token de GitHub desde producción.**

**Compuerta condicional:** si GitHub exige autenticación para descargar el ZIP, el laboratorio debe fallar sin atestación; se revisará después una credencial de solo lectura independiente. Nunca se fuerza `SOURCE_ATTESTED` mediante una inserción SQL directa.

## Evidencia necesaria

- CI de pruebas negativas del endpoint y transporte restrictivo.
- Aplicación de `migrations/control-plane/lab/0002_real_source_proof_receipt.sql` exclusivamente en D1 `d1e23807-b076-4c36-8785-7b423fc41614`.
- Worker dedicado `buffalo-real-source-proof-lab`, sin secretos y con único binding D1 a laboratorio.
- Acceso obligatorio Cloudflare Access con política de miembros de cuenta. Solo tras verificarlo habilitar temporalmente el subdominio.
- Una sola invocación autenticada de `POST /v1/lab/source/verify-once` y lectura independiente del recibo D1.
- Si `PASS`: exactamente una atestación `SOURCE_ATTESTED`, un evento `SOURCE_ATTESTED`, hashes vinculados y handoff original aún `REGISTERED_UNVERIFIED`, `execution_allowed=0`.
- Si `FAIL`: ningún éxito artificial. Inspeccionar fallo y mantener el límite de un solo uso.
- Apagar el subdominio, conservar evidencia y registrar un recibo final en un PR separado.

## Límites

Esto autentica procedencia de metadatos y la persistencia del verificador dentro del modelo de confianza de GitHub/Cloudflare, **no** ofrece firma SLSA/Sigstore, ni ejecuta Merlin, PySD, LLM, graders o servicios pagados. La D1 y el Worker productivos no se modifican en esta fase.
