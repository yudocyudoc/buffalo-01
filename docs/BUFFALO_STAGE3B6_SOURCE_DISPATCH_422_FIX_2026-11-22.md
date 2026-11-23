# Corrección 3B-6: GitHub workflow_dispatch requiere case_index como string

El run `45091736009` del bootstrap para `main@382211a838eb5b338883a44918a4611058710771` reconstruyó correctamente el manifiesto Merlin de `cffb07d9-78b5-464f-8194-3f6ffd144b90`; su digest fue `f7bf2ceb4f5bd18a6be3ca46b7955dd6d55d2e0a5fc8a45158c119f4721fc5ea`. Sin embargo, el dispatch del workflow `buffalo-full-source-proof.yml` recibió **HTTP 422 `Invalid value for input 'case_index'`**.

Causa confirmada: `gh api --field "inputs[case_index]=0"` convierte `0` al tipo JSON numérico, pero el input del workflow está declarado como `type: string`. No es un problema de Buffalo, agente, modelo, imagen, secretos o autorización GitHub.

Corrección: generador puro `scripts/full-integration/source-proof-dispatch-payload.mjs` con `case_index:'0'`, serializado vía `JSON.stringify` y transmitido por `gh api --input -`, sin coerción de tipos. Su salida se valida también en el job read-only del PR, y tiene tests propios de tipos, campos exactos y rechazos. El workflow original y el verificador D1 no se relajan ni modifican.

Un re-run del mismo bootstrap `run_attempt=2` está expresamente denegado; se necesita un nuevo SHA de `main`. El merge de esta corrección producirá un manifiesto nuevo para su propio SHA y, simultáneamente, una nueva imagen OCI privada verificada. **No reutilizar la declaración del commit anterior para el commit nuevo**.

Estado: ninguna nueva atestación D1 creada, ninguna autorización de inferencia, ningún Container iniciado por esta corrección.
