# Buffalo Full · Control Plane Fase 1 (D1 → GitHub Actions → D1)

**Corte:** 21 de noviembre de 2026. **Estado:** código en PR apilado sobre #13; no desplegado, no conectado a una D1 real y sin gasto de IA ni simulaciones. `paid-agent-case.yml`, Merlin, Sócrates, PySD y motores originales permanecen intactos.

## Pregunta y contrato

¿Podemos registrar una tarea de tipo cerrado, reclamar su despacho exactamente una vez, ejecutarla en GitHub Actions y acreditar su resultado antes de marcarla `SUCCEEDED`?

La única tarea habilitada es `BUFFALO_OFFLINE_ECHO_V1`; no hay ejecución de agentes, prompts, modelos ni comandos arbitrarios. `input_sha256` es **una huella de transporte**, no prueba de procesamiento de un archivo real. El workflow solo devuelve `NO_PROVIDER_NO_SIMULATION`.

## Componentes

- `workers/buffalo-control-plane/index.mjs`: cuatro rutas autenticadas con Bearer `CONTROL_API_TOKEN`: `POST /v1/tasks`, `GET /v1/tasks/{uuid}`, `POST /v1/tasks/{uuid}/dispatch`, `POST /v1/tasks/{uuid}/reconcile`. Sin CORS ni rutas de shell/SQL; faltan secretos o bindings → rechazo.
- `store.mjs`: binding D1 `DB`; inserción idempotente por UUID solo con mismo hash; reclamo condicional `READY→DISPATCHING`, transiciones permitidas y eventos append-only en el mismo batch SQLite. Migraciones `0001_tasks.sql` (#13) y `0002_dispatch_link.sql` (este PR).
- `github.mjs`: API autenticada de `yudocyudoc/buffalo-01`, solo workflow `buffalo-control-plane-offline.yml` sobre `main`. Comprueba que el workflow existe y fija SHA antes del POST; ninguna ruta a `paid-agent-case.yml`.
- `service.mjs`: `workflow_dispatch` aceptado no equivale a run ejecutado. Estado `SUBMITTED`; la reconciliación consulta run por UUID y verifica workflow ID, repo, branch, commit, tiempo y que no sea un rerun.
- Resultado: exige `conclusion=success` y un solo artifact no expirado, con digest SHA-256 GitHub validado contra bytes del ZIP, único miembro sin compresión con CRC correcto, JSON con UUID, hash de entrada, workflow, commit y tipo de evidencia. El hash de los bytes JSON queda en D1.

**Ambigüedad:** si un POST a GitHub falla, el envío pudo ocurrir. Se guarda `DISPATCH_UNKNOWN`; no hay retry automático. Una llamada de reconciliación puede recuperar el run si aparece con identidad verificada. Multiplicidad o evidencia no autenticable bloquea el éxito; no genera otro POST.

## Seguridad y permiso de despliegue

**No despliegues al preparar/revisar este PR.** Para un piloto real posterior, integrar primero #13 y este PR en `main`; crear una D1 específica, aplicar 0001→0002 una sola vez, desplegar el Worker con binding `DB`, configurar `CONTROL_API_TOKEN` de alta entropía y `GITHUB_FINE_GRAINED_TOKEN` limitado al repositorio (Actions lectura/escritura y Contents lectura). No publicar tokens, crear endpoints anónimos ni introducir credenciales en el workflow offline.

El control prueba sesiones **completas** y trabajos asíncronos, no reemplaza las llamadas frecuentes de herramientas de Merlin con un run de GitHub por turno. No modifica su loop de IA ni garantiza menor latencia de Gemma.

## Pruebas

```bash
node --test scripts/control-plane/contract.test.mjs workers/buffalo-control-plane/control-plane.test.mjs
python scripts/control-plane/test-sql-offline.py
```

Las pruebas cubren entrada cerrada, idempotencia, claim único, POST ambiguo, ausencia de run, múltiples runs, SHA ajeno, failure, artifact alterado, CRC, hash del JSON y acceso no autorizado. `test-sql-offline.py` aplica ambas migraciones en SQLite en memoria y verifica `changes()` con evento condicional.

**Evidencia disponible:** la primera versión de la batería pasó 16 tests Node y la prueba SQLite local; el PR añade un test directo de admisión D1 que debe verificarse en CI. Estas pruebas **no** demuestran el comportamiento del D1 productivo ni de las redirecciones de descarga de GitHub.

**Gate de cierre real:** una tarea offline completa `READY → SUBMITTED → GitHub run → ZIP autenticado → SUCCEEDED` sobre los servicios desplegados, más un segundo intento rechazado que confirme ausencia de doble despacho. Ese gate queda pendiente. Luego, y solo con otra autorización, se evalúa conectar al benchmark original de Merlin.
