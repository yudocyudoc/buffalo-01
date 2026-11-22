# Buffalo Full handoff V1 — smoke aislado Worker ↔ D1

Fecha de preparación: 2026-11-21.

## Hipótesis y frontera

La etapa 2 (PR #26) ya probó contratos y SQL mediante GitHub CI y API REST de D1, pero no el endpoint desplegado en un Worker con `env.DB`. Este ensayo cubre exactamente esa brecha sin emplear proveedores, GitHub Actions ni inferencia.

## Harness

- Módulo: `workers/buffalo-control-plane/full-handoff-lab.mjs`.
- Código productivo **ejercitado sin modificarlo**: `handle()` de `index.mjs`, `D1FullHandoffStore` y el contrato `handoff-contract.mjs`.
- Recurso D1 previsto: `buffalo-control-plane-race-lab-20261121` (`d1e23807-b076-4c36-8785-7b423fc41614`).
- Tabla solo de laboratorio: `migrations/control-plane/lab/0001_full_handoff_live_receipt.sql`.
- Worker de despliegue dedicado y protegido por Cloudflare Access, sin cron. No se usarán las credenciales de GitHub ni el Worker/D1 de producción.
- Una sola entrada autorizada: `POST /v1/lab/full-handoff/run-once` con JSON literal `{"action":"RUN_FULL_HANDOFF_LAB_V1"}`. Body arbitrario, GET, otras rutas o peticiones sin Access se rechazan.
- La admisión HTTP interna usa un bearer efímero solo dentro de la llamada al router. El cliente externo **no** lo recibe, y el backend de GitHub se sustituye por un objeto inerte. El único `DB` es el binding real al laboratorio.
- El registro `buffalo_full_handoff_lab_receipts` actúa como un one-shot atómico con estados `RUNNING/PASS/FAIL`. Una nueva solicitud nunca reinicia una prueba ya registrada.

## Casos

1. Ocho solicitudes simultáneas al endpoint original con el mismo manifiesto de laboratorio: 1 `201`, 7 `200`, un evento `DECLARATION_ADMITTED`, hash de manifiesto coincidente.
2. GET del endpoint original debe recuperar el recibo; el mismo UUID con cambios debe devolver `409` sin mutar el original.
3. `paid:true` y usar el tipo full por `/v1/tasks` deben ser rechazados; `/dispatch` del handoff no existe.
4. D1 debe rechazar cuatro actualizaciones: `SUCCEEDED`, `execution_allowed=1`, `provenance_verified=1` y asociación con `github_run_id`.

## Interpretación

El escenario `syntheticHandoffLab`, el UUID y todos los hashes del smoke son **valores sintéticos**; su `manifest_sha256` **sí** se calcula realmente mediante el código original. Un PASS confirma aislamiento/idempotencia/admisión en Worker→D1, **no** autenticidad del origen GitHub ni resultados de Buffalo Full.

La compuerta solo puede cerrarse con un `PASS` leído desde D1 y con el Worker de laboratorio desactivado de nuevo. Hasta entonces el ensayo es **pendiente**, aunque CI pase.

## Seguridad

Nunca desplegar a `buffalo-control-plane-offline`, nunca instalar `0003` en D1 productiva durante esta prueba. No cambiar `paid-agent-case.yml` ni iniciar el runner de agentes. Verificar la política de Cloudflare Access antes de habilitar el subdominio de laboratorio y deshabilitarlo tras el recibo.
