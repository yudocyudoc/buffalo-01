# Buffalo completo — primera prueba de agente con herramientas y una política

**Fecha:** 2026-11-20  
**Estado:** preparada, **no ejecutada**; requiere credenciales y consentimiento de consumo de API.  
**Referencia:** `UB-IAD/sd-ai`, usando sus archivos `agent/utilities/AgentEvalRunner.js` y `evals/categories/policyImplementation.js` sin modificarlos.

## ¿Qué probamos?

Una **sesión real del agente Merlin original**, usando su LLM, sus herramientas de modelado, el estado de modelo y el cliente PySD implementado por Buffalo para sus evaluaciones. No es una prueba de prompt aislado ni una llamada directa a `Engine.generate()` como el brazo B histórico.

El problema se toma **sin reescritura** de `evals/categories/policyImplementation.js`. Se selecciona uno de los escenarios de desarrollo existentes; el agente recibe el **modelo inicial**, la petición original de proponer/implementar una política y los límites del problema. Al finalizar, el evaluador original juzga **una sola generación** mediante tres criterios: la política alcanza el objetivo, no modifica hechos que la dirección no controla y el comportamiento del sistema sigue siendo plausible.

**Distinción metodológica:** usamos el harness original de evaluaciones de Buffalo. Ese harness conserva la configuración de agente del repositorio, pero **agrega una instrucción de modo evaluación** (`EVAL MODE: No User Present`) para que un agente pueda terminar sin que haya un usuario contestando preguntas. Esto no es idéntico a su comportamiento en una sesión interactiva de Stella; la diferencia debe quedar registrada al interpretar el resultado.

La traza registra qué herramientas llamó realmente el agente. La existencia de `run_model`, `get_variable_data` o `get_feedback_information` debe verse en el archivo de resultado, no inferirse de su discurso. Si no llama a alguna, se registra ausencia, no se le concede crédito.

## Condiciones precisas

- Agente por defecto: `merlin` (puede cambiarse por `themis`, `socrates` o `athena_SFD`; no son métodos equivalentes y no deben agregarse puntuaciones entre sí).
- Proveedor: `cloudflare`; el bootstrap externo reutiliza los adaptadores IGC y dirige agente + motores originales a Workers AI GLM-5.3, sin cambiar prompts, motores ni evaluación. Ver [integración completa](BUFFALO_CLOUDFLARE_COMPLETO.md).
- Un solo escenario de desarrollo, índice `0` por defecto; no se ejecutan grupos completos ni material held-out.
- Modelo/cliente de evaluación: SD-JSON → XMILE → PySD, en `AgentEvalRunner.js`. **No equivale a Stella** ni demuestra semántica de colas/eventos discretos o Loops That Matter real.
- La política se evalúa con los graders originales, no un juicio LLM propio.
- **Consumo de API:** un solo caso puede incluir múltiples llamadas del agente y los motores. El transporte limita 8 POSTs en el workflow manual, pero **no** impone un techo financiero en dólares. `merlin.md` permite hasta 50 iteraciones; el presupuesto de POSTs puede truncar la tarea.
- El runner escribe traza, modelo y evaluaciones localmente en `benchmark-runs/`, ignorado por Git. No subir archivos con prompts/datos sensibles sin revisión.

## Ejecución manual con Cloudflare Workers AI

El ejecutor usa **el proveedor Cloudflare**, no Gemini. Toda la configuración, los dos caminos (agente con herramientas y motor cuantitativo original), los tests sin costo y los pasos de GitHub Actions están documentados en [BUFFALO_CLOUDFLARE_COMPLETO.md](BUFFALO_CLOUDFLARE_COMPLETO.md).

El workflow `.github/workflows/paid-agent-case.yml` requiere `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, autorizar manualmente `I_ACCEPT_CLOUDFLARE_AI_COSTS` y ejecutar desde `main`. No existe una ejecución LLM implícita ni una dependencia de `GEMINI_API_KEY`.

En Linux, con Node y Python instalados y **solo después de consentir gastos**, se puede ejecutar:

```bash
export CLOUDFLARE_ACCOUNT_ID="ID_HEXADECIMAL_32"
export CLOUDFLARE_API_TOKEN="TOKEN_SECRETO_NO_VERSIONADO"
export BUFFALO_CF_MAX_POSTS=8
export BUFFALO_PAID_RUN=I_ACCEPT_CLOUDFLARE_AI_COSTS
node --import ./scripts/cloudflare/bootstrap.mjs scripts/run-one-native-agent-case.mjs
```

En Windows se recomienda WSL2/Linux con `python3` disponible, por el ejecutable fijado por el harness PySD de Buffalo. **No pegar ni guardar claves en GitHub, logs o mensajes.** Para ejecución reproducible, preferir la acción manual de GitHub con secretos.

## Interpretación

| Observación | Qué permite afirmar |
|---|---|
| El agente devuelve texto | Solo hubo respuesta; **no** acredita modelado |
| El log muestra ediciones o generación de modelo | Evidencia de interacción con herramientas, no de simulación exitosa |
| El log muestra `run_model` sin error | Evidencia de una llamada de simulación; verificar valores de salida |
| El log muestra `get_variable_data` | Evidencia de inspección numérica |
| Grader `meetsGoal` pasa | La política cruza el objetivo definido por el escenario simulado |
| Grader `intact` pasa | No alteró los elementos protegidos según las reglas de ese benchmark |
| Grader `sensible` pasa | No detectó comportamientos imposibles según el verificador de ese benchmark |

**No afirmar** que «Buffalo resuelve decisiones empresariales con éxito» a partir de un solo caso interno: faltan replicación, escenarios reservados, evidencia real y verificación externa del modelo. Tampoco afirmar que las herramientas de un cliente Stella estuvieron disponibles: en esta condición se usa el cliente PySD de los evaluadores.

## Qué sigue una vez ejecutado

1. Confirmar `toolLog` real, modelo final, las tres evaluaciones y costo; clasificar explícitamente fallos de ejecución, de modelado y de evaluación.
2. Comparar el mismo caso con Themis si el caso encaja en su metodología (puede negarse correctamente a certificar decisiones sin datos externos).
3. Después probar una sesión conversacional completa y un caso nuevo con datos no contenidos en los benchmarks de desarrollo.
4. Solo entonces conectar Stella y comparar las capacidades reales de su motor de simulación, diagnóstico dimensional y LTM con el harness PySD.

## Estado registrado

- Runner original de políticas disponible; transporte Cloudflare implementado en PR separado, pendiente de validación online.
- Código y evaluadores upstream modificados: **no**.
- Ejecución con LLM y herramientas: **no realizada**.
- Resultado empresarial: **ninguno**.

**Principio:** comprobar Buffalo como sistema completo sin disfrazar código existente como ejecución, ni un modelo simulable como una decisión empresarial válida.
