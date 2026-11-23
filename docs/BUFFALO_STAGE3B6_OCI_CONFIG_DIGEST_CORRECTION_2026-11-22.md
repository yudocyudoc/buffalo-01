# Buffalo 3B-6 · corrección del digest de configuración OCI

**Fecha:** 2026-11-22, México. **Incidente detectado antes del primer handshake real.**

El PR #56 fusionó el gate de dos recibos de una build. Los checks de publicación pasaron para `main@4db9189a2ec4f3fb08fa20153750a66945392cb4`, ejecución [45102368639](https://github.com/yudocyudoc/buffalo-01/actions/runs/45102368639), artifact `14786047309`. La imagen OCI se publicó y su **manifest digest** registrado es `sha256:42709b15da9392d44ce0a699f3bf641c1d2c922cb95f680c87517ae1aad7f7e0`.

Pero una inspección independiente de los logs encontró que BuildKit reportó `exporting config sha256:17431473a2b8d5f74e57f58fb4204bd139a5e96358a7d68685a8b51295923df3`. En contraste, el recibo `BUFFALO_PRIVATE_ORIGIN_BUILD_RECEIPT_V1` guardó `image_config_digest` igual al manifest digest (`42709b15...`), porque extrajo ese campo de `docker image inspect .Id`. En ese runner, **.Id no representaba el digest de los bytes del config OCI**. El recibo remoto repitió el mismo error. El trabajo CI comprobó que dos valores mal identificados coincidían, no que el config OCI fuera el correcto.

## Consecuencia y alcance

La presencia de la imagen en Cloudflare Registry, su manifest digest y la prueba de fuente GitHub para `4db9189a...` siguen siendo observaciones válidas. **Los campos config digest de ambos recibos no deben usarse como evidencia**. No inventar ni corregir retrospectivamente el artifact anterior. La imagen ya se preparó en Cloudflare con `ready`, sin iniciar Containers, pero esa preparación tampoco corrige el error de recibos.

## Corrección técnica

- Nuevo helper `infra/buffalo-origin/oci-config-digest.mjs`, extrae `manifest.json` de un `docker save`, localiza la ruta `Config` y calcula SHA-256 de los **bytes del JSON de config**. Solo permite rutas de config del archivo Docker; comprueba que el nombre del blob corresponde al hash calculado. No ejecuta imágenes ni llama a la red.
- Antes de publicar: `docker image save` de la imagen CI local, extrae su config digest, exige que no sea igual al manifest digest y registra ese valor en `BUFFALO_PRIVATE_ORIGIN_BUILD_RECEIPT_V1` junto al mismo run/attempt.
- Después de publicar y descargar: `docker image save` de la imagen del registro, extrae config bytes y compara su SHA-256 real contra el valor local. Verifica manifest digest separadamente mediante `RepoDigests`. En el recibo `BUFFALO_ORIGIN_PRIVATE_REGISTRY_RELEASE_V1` se registra el digest remoto de config obtenido de los bytes, no `.Id`.
- Tests unitarios negativos con archivo Docker sintético, incluidos nombres de config inválidos.
- El nuevo merge genera una nueva release candidata para su propio SHA, con ID Merlin **nuevo y no reutilizable** `f9c4db4e-aa31-4b2a-921e-201a5a79fd37`; no atribuir los recibos corregidos al commit anterior. La prueba de fuente seguirá usando el workflow `workflow_dispatch` original.

El parser de OCI, al igual que todo el gate, **no es una atestación de firma criptográfica** de GitHub/Cloudflare. Solamente refuerza la identificación comprobable de manifest y config digest, dos objetos distintos.

**Nada de esto despliega un Container, concede inferencia ni modifica D1.** Mantener el Worker de origen sin secretos, el bridge solo con D1 y la aplicación sin instancias, hasta validar la release nueva y el mapa de imágenes de Wrangler.
