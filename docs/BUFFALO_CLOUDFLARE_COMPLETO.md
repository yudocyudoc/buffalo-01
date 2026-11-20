# Buffalo completo con Cloudflare Workers AI — integración reutilizada

**Fecha:** 2026-11-20  
**Estado:** integración Cloudflare migrada a Inkling 2 Small; **todavía sin inferencia en vivo**.  
**Origen comprobado:** `yudocyudoc/igc-modular`, `arena/_vendor/igc/scripts/arena_b_cf_protocol_adapter.mjs` y `arena_b_ev01_cf_adapter.mjs`. Ambos archivos fueron copiados sin cambios a `scripts/cloudflare/`.

## Distinción crítica: el brazo B no era el agente completo

En Arena / IGC, el adaptador validado interceptaba el SDK OpenRouter de **`UB-IAD/sd-ai::Engine.generate`**, transformaba el request JSON Schema de Buffalo al formato REST de Cloudflare y devolvía un sobre compatible con OpenRouter. Los experimentos finales migraron el **modelo de destino real** desde `@cf/zai-org/glm-5.3-flash` hacia **`@cf/zai-org/glm-5.3`** tras un HTTP 410. El alias virtual histórico `cloudflare/glm-5.3-flash` seguía siendo la clave de enrutamiento interna de Buffalo: **no designa el modelo real usado por Cloudflare**. **A partir de esta migración, el modelo efectivo para las dos rutas es `@cf/thinkingmachines/inkling-2-small`.** Cloudflare retiró el modelo `glm-5.3-flash` el 20 de noviembre de 2026, no el modelo distinto `glm-5.3` (que figura entre sus recomendaciones).

El sistema completo de Buffalo tiene otra capa: Merlin / Themis / Sócrates / Athena mantienen una conversación y llaman herramientas. El bootstrap conserva **dos caminos originales distintos**:

```text
Merlin (AgentEvalRunner / AgentOrchestrator original)
   |-- Conversación + tool calls
   |     Original OpenAI-compatible manual provider loop
   |       -> Cloudflare /ai/v1/chat/completions
   |          model @cf/thinkingmachines/inkling-2-small
   |
   |-- Herramienta generate_quantitative_model, etc.
   |     Original LLMWrapper -> OpenRouter SDK virtual
   |       -> adaptadores históricos IGC (JSON Schema, 16k)
   |       -> Cloudflare /ai/run/@cf/thinkingmachines/inkling-2-small
   |
   +-- get_current_model, update_model, run_model,
       get_variable_data, grader nativo, PySD
```

Los motores no cuantitativos (Seldon, discusión y generación cualitativa) requieren otros esquemas; añadimos `other-engine-transport.mjs` para transportar su JSON Schema sin modificar los motores originales. **Este camino genérico solo está validado offline**, no se debe confundir con compatibilidad de ejecución demostrada para cada motor.

**No hay OpenRouter real ni Gemini.** El transporte se activa por precarga en proceso Node y registra dinámicamente `cloudflare` como proveedor de agentes; no se modifican `config.js`, `AgentOrchestrator.js`, `LLMWrapper.js`, los MD de agentes ni los evaluadores.

**Separación de identidades:** `scripts/cloudflare/active-model.mjs` establece el único modelo real, `@cf/thinkingmachines/inkling-2-small`. Los dos adaptadores IGC originales conservan su contenido y hash, incluido el alias `cloudflare/glm-5.3-flash`. Este alias solo activa el enrutamiento SDK y el adaptador histórico; **nunca** debe terminar como URL o campo `model` del POST a Cloudflare.

## Diferencias frente a EV-01 y Q75

- **Se conserva:** dos módulos originales de protocolo IGC, alias virtual de Buffalo, `response_format=json_schema`, bare schema Cloudflare, `reasoning_effort=low`, techo 16.000 tokens para el generador, endpoint real Inkling 2 Small, sin reparaciones de JSON ni cambios de ecuaciones.
- **Es nuevo y debe verificarse:** la **función calling multi-turn** del agente original mediante API OpenAI-compatible de Cloudflare. El viejo adaptador de una respuesta JSON no era suficiente para gestionar conversaciones y herramientas. Workers AI documenta soporte de herramientas de Inkling 2 Small; compatibilidad **en el SDK de Buffalo** requiere ejecución.
- **Límites:** el brazo B previo tenía un máximo de **1 POST** por prueba autorizada. Un agente requiere varias rondas; este ejercicio usa **máximo 8 POSTS** de inferencia (agente + motores en conjunto), cuenta cada HTTP, rechaza reenvíos de cuerpos idénticos y no dispara nuevas ejecuciones automáticas. El límite de POSTs no es un límite de costo en dólares. La política de retries interna de los SDK no ha sido modificada; cualquier POST efectivo, incluidos retries, consume presupuesto y se registra.
- **Simulación:** el harness original de evaluaciones usa PySD, no Stella. No presupone que Loops That Matter esté presente en el harness ni que todas las prestaciones de Stella sean equivalentes.
- **Modo de agente:** el proveedor OpenAI-compatible de Buffalo utiliza su loop `manual` aunque `merlin.md` declare `sdk`. Es **la implementación original de Buffalo** para proveedores compatibles; no afirmar que prueba el Anthropic Agent SDK.

## Instalación y secretos

Se mantienen Node 22 y Python 3.11 para los tests. En el **fork Buffalo** (no basta tener estos secretos en `igc-modular`) crear:

- Variable o secret `CLOUDFLARE_ACCOUNT_ID` (32 dígitos hexadecimales).
- Secret `CLOUDFLARE_API_TOKEN`, con permisos mínimos para Workers AI.

No crear `GEMINI_API_KEY`, `OPEN_ROUTER_API_KEY`, ni copiar credenciales a `.env` versionado. El bootstrap usa un alias sin acceso real a OpenRouter.

## Prueba sin costo

```bash
npm ci
CLOUDFLARE_ACCOUNT_ID=00000000000000000000000000000000 \
BUFFALO_CF_OFFLINE=1 BUFFALO_CF_MAX_POSTS=4 \
node --import ./scripts/cloudflare/bootstrap.mjs \
  scripts/cloudflare/offline-contract.mjs
```

El contrato verifica registro del proveedor, destino Inkling 2 Small en ambas rutas y en recibos, lane de modelos de herramientas original, serialización JSON Schema heredada y **bloquea** tanto el POST del agente como el POST del generador antes de realizar red. Ejecutado automáticamente en `.github/workflows/cloudflare-offline-contract.yml` después de abrir PR; **no se cobra ni se consultan secretos**.

## Prueba real, exclusivamente manual

El flujo existente `.github/workflows/paid-agent-case.yml` fue migrado de Gemini a Cloudflare. Cuando el PR de migración a Inkling esté fusionado en `main`:

1. Abrir Actions → **Buffalo original agent via Cloudflare Workers AI (paid; manual only)**.
2. Seleccionar `merlin`, índice `0` (caso `dialysisClinic`) y autorizar `I_ACCEPT_CLOUDFLARE_AI_COSTS`.
3. Se ejecuta **un único caso de política**, con límite de **8 inferencias POST** y sin reintento automático del workflow, solo en primer intento desde `main`.
4. Se conserva un artefacto JSON de evidencia con `toolLog`, modelo final, tres graders originales y recibos por POST. Revisar antes de compartir porque el repositorio es público.

La prueba puede fallar porque el presupuesto de 8 POSTs no baste para que Merlin termine. Eso se registra como **presupuesto insuficiente**, no como prueba de incapacidad del agente. Los resultados numéricos deben basarse en los graders de Buffalo, no en las afirmaciones textuales del modelo.

## No afirmaciones

- La precarga demuestra **configuración propuesta**, no compatibilidad ya confirmada en vivo.
- Un contrato offline verde prueba enrutamiento y guardas, **no** llamadas a herramientas reales de Inkling 2 Small.
- Una política que pasa los tres criterios en un caso sintético prueba ese benchmark, **no** fiabilidad empresarial externa ni ajuste a datos reales.
- Los precios que Buffalo atribuya a un proveedor no registrado en `TokenUsageReporter` pueden ser aproximaciones de OpenAI; usar consumo de Cloudflare para costos reales. El transporte archiva `usage` cuando la respuesta lo proporciona.
- Los subtipos discretos de Stella (colas/oven/conveyor) no quedan certificados por PySD.

## Procedencia

- Integración probada: [IGC original](https://github.com/yudocyudoc/IGC/blob/main/scripts/arena_b_cf_protocol_adapter.mjs) y [EV-01 de igc-modular](https://github.com/yudocyudoc/igc-modular/blob/main/arena/_vendor/igc/scripts/arena_b_ev01_cf_adapter.mjs).
- Cambio de modelo al GLM-5.3 en [Q75](https://github.com/yudocyudoc/igc-modular/blob/main/arena/coffee_q75_buffalo_provider_target.mjs).
- [Cloudflare: Inkling 2 Small (function calling, JSON schema y razonamiento)](https://developers.cloudflare.com/workers-ai/models/inkling-2-small/).
- [Cloudflare: anuncio de modelos retirados el 20 de noviembre](https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/).
- [Cloudflare: endpoint OpenAI compatible](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/).

**Objetivo de la prueba:** Buffalo completo con su lógica original, Workers AI como proveedor de inferencia, PySD en el harness original y evidencia reproducible. No trasladar Arena, ATMS ni OpenModelica a esta fase.
