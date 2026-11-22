# Buffalo Stage 3B-6 · corrección de identidad inmutable del handoff

**Motivo:** el WebSocket bridge original consultaba un UUID fijo (el handoff histórico `6bce82ee-d179-4a2e-9317-f7f4708c5be2`) y exigía `commit_sha = BUFFALO_RUNTIME_COMMIT_SHA`. La prueba histórica fue atestada para `66bee2d96ec71692608fc0829486c2dc130ab7a0`. La imagen nueva proviene de un commit posterior. En D1, `buffalo_full_source_attestations` es inmutable y `buffalo_full_handoffs` también preserva la identidad original. Por diseño, ese registro anterior **no puede habilitar el nuevo origen** y no se debe modificar.

## Corrección

- `BUFFALO_LAB_HANDOFF_ID` pasa a ser requisito **servidor** del Worker bridge y debe ser UUID v4 válido (la expresión valida formato UUID estándar con versiones 1-8). El ID jamás se recibe en URL, headers ni frames del navegador.
- `readVerifiedSource` hace una consulta SELECT por el UUID configurado y mantiene todas las comparaciones previas de `SOURCE_ATTESTED`, `commit_sha`, SHA del modelo, digest de manifiesto, agente `merlin` y `mode=sfd`.
- El gate offline 3B-6 exige que el `handoff_id` elegido por el operador coincida con la atestación declarada; sin esa prueba no produce configuración de Container.
- Los tests comprueban que un handoff nuevo bien formado puede pasar el SELECT y que uno diferente, sin la evidencia correspondiente, falla cerrado. No se cambió la semántica de inferencia: `chat`, `select_agent`, `WorkerSpawner.spawn` y acceso a modelos siguen negados.

## Paso pendiente, sin atajos

1. Fusionar el código y generar build CI del commit de `main` definitivo.
2. Generar un **nuevo** handoff Merlin desde el benchmark original con `prepare-handoff.mjs`, para ese mismo commit de despliegue, y registrar su manifest inmutable en D1 experimental por el flujo canónico.
3. Ejecutar el workflow autenticado `buffalo-full-source-proof.yml` para ese handoff y su manifest exacto; comprobar el run y persistir atestación mediante los mecanismos canónicos (no escritura SQL manual).
4. Fijar en configuración del bridge privado `BUFFALO_LAB_HANDOFF_ID`, `BUFFALO_RUNTIME_COMMIT_SHA` y hash del modelo. El Contenedor debe exigir la misma identidad de commit.
5. Publicar y comprobar por digest la imagen remota, configurar los secrets en Cloudflare y validar la topología Worker→DO→Container con acceso temporal protegido. No ejecutar turnos de agente.

Esto **corrige una dependencia bloqueante**; no crea handoffs, no atesta datos ni despliega Container por sí solo.
