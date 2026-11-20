# Buffalo completo — primera prueba de agente con herramientas y una política

**Fecha:** 2026-11-20  
**Estado:** preparada, **no ejecutada**; requiere credenciales y consentimiento de consumo de API.  
**Referencia:** `UB-IAD/sd-ai`, usando sus archivos `agent/utilities/AgentEvalRunner.js` y `evals/categories/policyImplementation.js` sin modificarlos.

## ¿Qué probamos?

Una **sesión real del agente Merlin original**, usando su LLM, sus herramientas de modelado, el estado de modelo y el cliente PySD implementado por Buffalo para sus evaluaciones. No es una prueba de prompt aislado ni una llamada directa a `Engine.generate()` como el brazo B histórico.

El problema se toma **sin reescritura** de `evals/categories/policyImplementation.js`. Se selecciona uno de los escenarios de desarrollo existentes; el agente recibe el **modelo inicial**, la petición original de proponer/implementar una política y los límites del problema. Al finalizar, el evaluador original juzga **una sola generación** mediante tres criterios: la política alcanza el objetivo, no modifica hechos que la dirección no controla y el comportamiento del sistema sigue siendo plausible.

La traza registra qué herramientas llamó realmente el agente. La existencia de `run_model`, `get_variable_data` o `get_feedback_information` debe verse en el archivo de resultado, no inferirse de su discurso. Si no llama a alguna, se registra ausencia, no se le concede crédito.

## Condiciones precisas

- Agente por defecto: `merlin` (puede cambiarse por `themis`, `socrates` o `athena_SFD`; no son métodos equivalentes y no deben agregarse puntuaciones entre sí).
- Proveedor: `google`, con la configuración Gemini original del fork (`config.js`), para no cambiar los modelos de sus herramientas.
- Un solo escenario de desarrollo, índice `0` por defecto; no se ejecutan grupos completos ni material held-out.
- Modelo/cliente de evaluación: SD-JSON → XMILE → PySD, en `AgentEvalRunner.js`. **No equivale a Stella** ni demuestra semántica de colas/eventos discretos o Loops That Matter real.
- La política se evalúa con los graders originales, no un juicio LLM propio.
- **Consumo de API:** un solo caso puede incluir múltiples llamadas del agente y los motores. No se impone un límite financiero automático; antes de habilitarlo debe aceptarse ese costo. `merlin.md` permite hasta 50 iteraciones. No ejecutar accidentalmente en CI.
- El runner escribe traza, modelo y evaluaciones localmente en `benchmark-runs/`, ignorado por Git. No subir archivos con prompts/datos sensibles sin revisión.

## Ejecución local (Linux/macOS)

Con Buffalo y PySD previamente instalados, y después de que el smoke de infraestructura funcione:

```bash
export GEMINI_API_KEY="TU_CLAVE_AQUI"
export BUFFALO_PAID_RUN=I_ACCEPT_API_COSTS
node scripts/run-one-native-agent-case.mjs
```

En Windows PowerShell:

```powershell
$env:GEMINI_API_KEY = "TU_CLAVE_AQUI"
$env:BUFFALO_PAID_RUN = "I_ACCEPT_API_COSTS"
# El evaluador Buffalo invoca python3; verificar que este comando exista en PATH.
python3 --version
node scripts/run-one-native-agent-case.mjs
```

**Para Windows, se recomienda ejecutar en WSL2/Linux con `python3` disponible: `AgentEvalRunner.js` instancia PySD sin override de ejecutable y el default de `PySDSimulator` es `python3`. En Windows nativo, `python` o `py` no sustituyen automáticamente ese comando.**

**No escribir claves dentro del repositorio**. La configuración de Gemini se usa tanto para la conversación del agente como para el motor cuantitativo en la configuración por defecto.

Variantes, sin modificar los prompts:

```bash
BUFFALO_AGENT=themis BUFFALO_CASE_INDEX=0 node scripts/run-one-native-agent-case.mjs
```

Verificar primero la presencia de `GEMINI_API_KEY` y `BUFFALO_PAID_RUN`. Si faltan, el script termina antes de llamar al proveedor. El script es manual a propósito: ninguna ejecución de GitHub Actions debe consumir saldo accidentalmente.

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

- Runner creado y en PR separado: **sí**.
- Código y evaluadores upstream modificados: **no**.
- Ejecución con LLM y herramientas: **no realizada**.
- Resultado empresarial: **ninguno**.

**Principio:** comprobar Buffalo como sistema completo sin disfrazar código existente como ejecución, ni un modelo simulable como una decisión empresarial válida.
