# Buffalo Full — Recibo de instalación del Control Plane offline

Fecha: 2026-11-21, México. Documento de evidencia operativa, NO resultado de un benchmark.

## Integración en GitHub

- PR #13 integrado en `main` (merge `dc3acbe7243d570e658a144eb1000e1967fd94fc`).
- PR #14 integrado en `main` (merge `5b37aeaf6e32a4ad490d3754dd441f90b55a10d4`).
- Se corrigió antes del merge el lector de ZIP para permitir `DEFLATE` (además de `STORED`), verificar CRC32, SHA-256 y tamaño máximo. Sus CI offline finalizaron exitosamente.
- No se tocó `paid-agent-case.yml`, `AgentOrchestrator.js`, prompts originales, PySD, modelos ni agentes.

## Recursos Cloudflare creados exclusivamente para Buffalo

- Base D1: `buffalo-control-plane-offline`, UUID `8c44bc0c-8c49-4bc1-8a48-adb20f814a9a`.
- Migraciones aplicadas directamente sobre esta nueva D1 desde `migrations/control-plane/0001_tasks.sql` y `0002_dispatch_link.sql`. API Cloudflare informó `success: true` en cada sentencia.
- Verificación posterior: existen las tablas `buffalo_tasks`, `buffalo_task_events`; `buffalo_tasks` incluye `dispatch_head_sha`, `dispatch_started_at`, `github_workflow_id`, `github_artifact_id`.
- Worker: `buffalo-control-plane-offline` cargado mediante API de módulos. `compatibility_date: 2026-11-21`, `nodejs_compat` y binding `DB` con UUID exacto de arriba.
- `GET /workers/scripts/.../settings` verificó binding D1 y compatibility date; API mostró un deployment.
- `GET /workers/scripts/.../subdomain` indicó `enabled: false`, `previews_enabled: false`.
- `GET /workers/scripts/.../secrets` mostró **cero secretos**. `CONTROL_API_TOKEN` y `GITHUB_FINE_GRAINED_TOKEN` NO están configurados: el Worker falla cerrado ante solicitudes no autorizadas, y no puede despachar.
- Consulta D1 posterior: **0 tasks, 0 events**. No se envió workflow_dispatch, ningún agente y ninguna inferencia de Workers AI.

## Condiciones de reactivación segura (aún pendientes)

1. Configurar **fuera de este repositorio y de cualquier chat público** `CONTROL_API_TOKEN` aleatorio de alta entropía (mínimo 32 caracteres) como secreto del Worker; no exponer endpoints de manera anónima.
2. Configurar `GITHUB_FINE_GRAINED_TOKEN` como secreto independiente del mismo Worker, limitado a `yudocyudoc/buffalo-01`, con permisos para consultar workflow/runs/artefactos, ejecutar únicamente el workflow offline autorizado por el código, y leer el commit de `main`. **El token no existe automáticamente por conectar ChatGPT a GitHub**.
3. No publicar el Worker en `workers.dev` ni crear una ruta pública sin configurar acceso restringido; preferir Cloudflare Access o service binding privado y comprobar autorización. El único flujo aceptado continúa siendo `BUFFALO_OFFLINE_ECHO_V1`.
4. Ejecutar una única tarea offline `POST /v1/tasks`, luego `POST /v1/tasks/{uuid}/dispatch`; conciliar por `POST /v1/tasks/{uuid}/reconcile` solo después de constatar que el workflow está disponible en `main`.
5. Exigir evidencia remota: un run auténtico, ZIP SHA-256 y JSON verificados, un evento `SUCCEEDED` en D1 y una segunda solicitud de despacho rechazada sin duplicar el run. Si hay `DISPATCH_UNKNOWN`, reconciliar; **nunca reintentar a ciegas**.
6. Si el formato real del artifact o la política del proveedor difieren del mock, dejar fallo visible, no forzar `SUCCEEDED`.

## Límites y advertencias

La subida de código a Cloudflare y la aplicación de migraciones **no demuestran el circuito E2E**. Los ensayos de CI son offline con simulaciones; falta autorización GitHub desde el Worker y prueba con un run real. La cuenta Cloudflare contiene otras bases y Workers ajenos a este experimento; ninguno de ellos debe modificarse.

El Worker publicado mediante subida API no incorpora todavía una receta automatizada de despliegue reproducible en el repo (la fuente está en `workers/buffalo-control-plane/`); conviene añadir una configuración de despliegue dedicada si se automatizan actualizaciones futuras. No utilizar secretos de otros proyectos ni el API token de Workers AI para el dispatcher.

**Siguiente hito:** circuito offline real con una sola tarea y comprobación de auditoría. La integración de Merlin y la prueba de latencia TTFB son etapas posteriores y separadas.
