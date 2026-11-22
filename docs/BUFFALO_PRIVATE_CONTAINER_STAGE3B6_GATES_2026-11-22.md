# Buffalo original · 3B-6 · gate de despliegue privado y handshake Cloudflare

**Fecha:** 2026-11-22. **Estado:** preparación y validación de contrato offline. **No** es un despliegue ni una autorización de gastos/inferencia.

## Evidencia comprobada al iniciar

Cuenta Cloudflare examinada vía API, solo lectura:
- Applications Containers: **0**; uso actual **0 instancias, 0 memoria, 0 disco, 0 vCPU**.
- `buffalo-original-ws-bridge-lab`: existe, configuración `compatibility_date=2026-11-21`, **solo** binding D1 (`DB`), subdominio y previews deshabilitados, 0 secretos, 0 schedules, sin binding `BUFFALO_ORIGIN`.
- El Worker productivo y el repositorio no se han modificado mediante esta inspección.

3B-5 en `main@cf82dd81815720beb8767eef459d18fd00998c8a`: build local del origen y prueba Node 4/4 PASS en GitHub Actions [44992589568](https://github.com/yudocyudoc/buffalo-01/actions/runs/44992589568). Digest de manifiesto **local** `sha256:521faf756e69f27e42432fc9780da71a06e588aace48a1c02fa27dbe1ebfd3dc`. Digest config local `sha256:1b39cc6239f67467ced46810b86a7502d229a371f4ce85e4185404d54ef66e0d`. **Ninguno** se ha confirmado publicado en el registro Cloudflare. Un nuevo commit tras este PR requiere recibo de build propio: no reutilizar ese digest como imagen del HEAD nuevo.

## Bloqueos efectivos antes del primer despliegue / handshake

1. **Imagen remota inexistente/no verificada.** El controlador con política `durable_object` requiere `images.base.image` con referencia digest-pinned del registro Cloudflare. No se permite apuntar a una etiqueta mutable ni representar el digest local como remoto. El flujo controlado debe hacer push de la imagen construida, pull/inspect independiente y cotejo de `manifest digest`, `config digest`, source SHA, usuario y modo. Si el push reescribe el manifiesto, el gate lo bloquea; reconciliar la transformación con un recibo nuevo antes de continuar.
2. **Atestación de fuente antigua.** La comprobación del puente D1 exige `SOURCE_ATTESTED` para el **mismo commit del runtime** y manifiesto/modelo del handoff. El registro anterior pertenece a `66bee2d96ec71692608fc0829486c2dc130ab7a0`, no a la imagen 3B-5 ni al futuro 3B-6. No actualizar D1 por editar un JSON ni falsear `execution_allowed`.
3. **Servicio privado no conectado.** El Worker puente conserva solo D1 y ninguna credencial/servicio de origen. El deploy privado debe introducir `BUFFALO_ORIGIN` apuntando a `buffalo-private-origin-router-lab`, sin URL pública del origen, y exigir tres secretos independientes (bearer, auth Buffalo, token de upgrade) guardados en Cloudflare, nunca en GitHub o chat.
4. **Gasto.** Cloudflare cobra Containers mientras están activos. `max_instances=1`, instancia `lite`, `enableInternet:false`, `inactivityTimeout=60s` y no chat limitan superficie de consumo, **no son un tope monetario universal**. Comprobar plan y límites efectivos de factura antes de arranque; no inferir que gasto será exactamente cero. [Precios oficiales](https://developers.cloudflare.com/containers/platform/pricing/).
5. **Conectividad no probada.** Ni los tests Node ni la comprobación local de imagen demuestran aún `workerd → Durable Object → Container → WebSocketHandler` o que un `101` recorra toda la cadena. El controlador real no puede proclamarse validado hasta ejecutarlo bajo workerd y Container.

## Entrega de este PR

- `infra/buffalo-origin/stage3b6-preflight.mjs`: herramienta **pura, offline**. Recibe archivo de evidencia explícita y solo crea un JSON privado de configuración si todos los predicados declarados pasan. No tiene llamada a Cloudflare o GitHub, no publica imágenes, no ejecuta un Container y no escribe secretos. Su resultado positivo significa **configuración preparada para inspección, no despliegue autorizado**.
- `stage3b6-preflight.test.mjs`: rechaza digest remoto diferente, uso de etiqueta mutable, ausencia de verificación independiente de registro, atestación del commit antiguo, fuente sin modelo, bridge público, presencia de secretos previos, permisos de inferencia, Internet o varias instancias.
- CI existente ejecuta sus tests baratos ante cambios de origen. La preparación de configuración **no crea** `wrangler.jsonc` raíz ni un trigger automático para desplegar Containers.

El preflight exige un readback declarativo; los tests de fixtures no prueban por sí mismos que Cloudflare tenga ese estado. Antes de consumir la configuración generada, un operador debe corroborar las respuestas de la API y el recibo OCI, sin transformar una autoafirmación en prueba independiente.

## Secuencia para habilitar 3B-6 live

**A. Registro y procedencia.** Elegir el SHA definitivo del HEAD de despliegue, construir con el gate 3B-5, publicar esa imagen en registro privado Cloudflare, recuperar metadatos remotos y reconstruir el recibo. El SHA, digest remoto y runtime deben coincidir.

**B. Atestación D1 real.** Crear/validar handoff y `SOURCE_ATTESTED` para el runtime de A, con `initial_model_sha256` exacto, sin grant ni `execution_allowed`. Usar los mecanismos canónicos, no alterar manualmente los campos.

**C. Deploy privado y sin ejecución.** Crear aplicación Container separada, DO + `BUFFALO_CONTAINER`, `scheduling_policy='durable_object'`, imagen por digest y `max_instances=1`; sin URL ni previews públicos; secretos desde Cloudflare. No introducir binding `BUFFALO_ORIGIN` en puente hasta comprobar controles. Se debe verificar que el Container sigue detenido.

**D. Un handshake real.** Releer grants (0), configuración e imagen; habilitar un acceso temporal protegido, conectar service binding al origen y emitir **un solo** `session_created → initialize_session → session_ready → disconnect`, verificando bloqueo `WorkerSpawner.spawn`, `select_agent`, `chat` y `provider_requests=0`. Registrar HTTP 101 y cierre por código; evaluar costo efectivo y apagar ruta al terminar.

**E. Evidencia final.** Guardar commit, imagen, hash de modelo, recibos, secretos presentes solo por nombre, run, identificadores de despliegue, estado de Container antes/después, número de arranques, uso y coste disponible; no reportar como ejecución de Merlin.

## Protección científica y técnica

No modificar `agent/`, el SDK, PySD ni modelo emitido por Buffalo. No habilitar tickets de inferencia, POST de proveedor, live chat, grants, colas o workers productivos. Si falta una dependencia, **cerrar el gate con razón concreta**, no realizar bypass ni repetir builds para forzar un PASS.
