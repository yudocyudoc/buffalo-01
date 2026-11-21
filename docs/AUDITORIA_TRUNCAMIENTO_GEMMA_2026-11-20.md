# Auditoría del cierre prematuro de Gemma y corrección de transporte

**Fecha:** 2026-11-20 (Ciudad de México; el log de GitHub está en UTC).  
**Ejecución investigada:** [GitHub Actions run 44846658585](https://github.com/yudocyudoc/buffalo-01/actions/runs/44846658585) — commit `a89fc562` y caso original `policyImplementation/dialysisClinic`, Merlin, Gemma 4 26B A4B.  
**Artefacto original:** [GitHub artifact 14683796044](https://github.com/yudocyudoc/buffalo-01/actions/runs/44846658585/artifacts/14683796044) (retención configurada 7 días).

## Hallazgo comprobable

- Cloudflare respondió **HTTP 200** en las dos peticiones. Primera respuesta: `finish_reason=tool_calls`, 442 tokens de salida, una llamada a `read_model_section`.
- Segunda respuesta: `finish_reason=length`, **4096 tokens de salida exactamente**, cero llamadas a herramientas y ninguna modificación posterior del modelo.
- El adaptador anterior imponía un límite de **4096 tokens por respuesta**, idéntico para Gemma e Inkling.
- El bucle manual de Buffalo, `AgentOrchestrator.processOpenAiManualResponse`, declara éxito cuando no existen `tool_calls`, sin verificar `finish_reason`. Por eso `runAgent` devolvió un modelo no intervenido y los graders se ejecutaron: `meetsGoal`, `intact`, `sensible` fallaron; la lista de espera permaneció en **107.3** frente al objetivo **80**.
- El proceso usó **476.38 neuronas** y 38,788 tokens de entrada + 4,538 de salida. No hubo fallo de la cuenta, ni del límite de POSTS, ni del límite local de neuronas.
- El contenido completo del razonamiento no se almacena. **No se puede demostrar** que los 4096 tokens fueran solo razonamiento oculto. Sí se demuestra el truncamiento.

## Decisión

Corregir **solo la capa experimental Cloudflare y el ejecutor de benchmark**. No editar los prompts, métodos del agente, ecuaciones SD, simulador PySD, evaluadores originales o los adaptadores históricos IGC.

### (1) Gemma sin razonamiento interno

La documentación y el [esquema oficial de Cloudflare](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/gemma-4-26b-a4b-it.json) incluyen `chat_template_kwargs.enable_thinking` (verdadero de forma predeterminada).

- En **Gemma**, enviar `chat_template_kwargs: { enable_thinking: false }` tanto por la ruta de agente `/ai/v1/chat/completions` como por la ruta de motor `/ai/run/<modelo>`.
- Si el adaptador histórico de motores inserta `reasoning_effort: low`, eliminarlo únicamente de la solicitud **final de Gemma**, para no enviar dos directivas de razonamiento contradictorias. El adaptador original no se modifica.
- En **Inkling**, mantener exactamente el comportamiento previo: no inyectar `chat_template_kwargs` ni retirar `reasoning_effort`.

Esto es un **nuevo brazo de configuración**, no una repetición idéntica de la primera prueba de Gemma.

### (2) Interpretación correcta de respuesta incompleta

En la ruta de agente, conservar el recibo de Cloudflare: HTTP real, hash de respuesta, `finish_reason`, `tool_calls_count`, tokens y neuronas. Si HTTP es 200 pero `finish_reason=length`:

1. Marcar el recibo `OUTPUT_TRUNCATED`, conservar `http_status=200`, registrar `client_http_status=422` y contador `truncatedResponses`.
2. Devolver al SDK una **respuesta local HTTP 422** con `BUFFALO_CF_OUTPUT_TRUNCATED`; así el bucle original reporta error en lugar de emitir éxito por ausencia de `tool_calls`. **No es un error HTTP de Cloudflare.**
3. No retransmitir texto parcial ni solicitudes de herramientas potencialmente incompletas.
4. Bloquear nuevos POSTS dentro de la misma ejecución después de detectar truncamiento. Esto evita reintentos automáticos con costo no autorizado.

Si la respuesta termina con `stop` o `tool_calls`, pasar sus bytes y semántica sin modificar, exactamente como antes.

### (3) No ejecutar graders sobre respuestas truncadas

Tras `runAgent`, el ejecutor consulta `diagnostics()`. Si consta `truncatedResponses>0` o un bloqueo de presupuesto/medición, no ejecuta `evaluate`. Guarda `status=output_truncated`, `stopReason=CLOUDFLARE_OUTPUT_TRUNCATED`, `gradingStatus=not_executed`, `grades=[]` y código de salida **2**. GitHub Actions quedará rojo **correctamente** (no como error de conectividad) y el artefacto se guardará mediante `if: always()`.

El contador de neuronas sigue incluyendo respuestas truncadas: aunque no sirvan para calificar políticas, sí consumieron recursos.

### (4) Pruebas sin inferencia

- `completion-policy-offline.mjs`: configuración selectiva de Gemma, conservación de Inkling y clasificación `length`, `stop`, `tool_calls`, así como el gate de evaluación.
- `mock-origin-preload.mjs` + `completion-transport-mock-offline.mjs`: simular HTTP 200 en un `fetch` interceptado **antes de cargar bootstrap**, sin conexión real, y verificar que `length` se transforma en 422, mantiene metering y bloquea intentos posteriores. `stop` y `tool_calls` deben permanecer en HTTP 200.
- Matriz de CI Gemma + Inkling; contrato de enrutamiento y budget anterior se conserva.
- **No se ejecuta ningún workflow pagado en este PR** y no se elevan los límites actuales de 4096 tokens, 8/16/24 POSTS ni 2000/4000/6000 neuronas.

## Siguiente experimento (pendiente de autorización manual)

Una sola ejecución **Gemma / Merlin / dialysisClinic / `max_posts=16` / `max_neurons=4000`**, con el razonamiento explícitamente deshabilitado y detección de truncamiento. Comparar `tool_calls`, `run_model`, uso de neuronas y resultados del grader original. De preferencia ejecutar solo cuando los CI estén verdes, y consultar el uso total diario de Cloudflare si se quiere permanecer dentro de las 10,000 neuronas gratuitas.

**Éxito esperado de la corrección técnica:** no significa alcanzar la meta clínica. Significa no aceptar silenciosamente un `finish_reason=length`, y dejar que el experimento indique de forma legible si Gemma pudo continuar, completar o fallar sin gastar neuronas innecesarias.
