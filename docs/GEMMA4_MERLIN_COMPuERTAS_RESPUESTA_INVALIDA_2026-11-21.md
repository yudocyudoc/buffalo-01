# Gemma 4 / Merlin: compuertas de contrato para salidas inválidas

**Fecha:** 2026-11-21, Ciudad de México.  
**Motivo:** auditoría de esquemas y protocolo documentada en [PR #10](https://github.com/yudocyudoc/buffalo-01/pull/10).  
**Separación de alcance:** este cambio SOLO toca `scripts/cloudflare/`, su CI y la documentación. **No modifica** `agent/AgentOrchestrator.js`, Merlin, los motores SD, los evaluadores originales o presupuestos.

## Riesgo de falso éxito

Buffalo procesa las respuestas del endpoint OpenAI-compatible con `processOpenAiManualResponse`. Cuando `message.tool_calls` está vacío, puede reportar `Task completed successfully`, sin verificar el `finish_reason` del proveedor. Ya protegimos `finish_reason=length` en PR #8, pero existe un segundo escenario plausible y documentado por [cloudflare/ai#561](https://github.com/cloudflare/ai/issues/561): **HTTP 200 + `finish_reason=tool_calls` + `message.tool_calls=[]`**. También una respuesta `finish_reason=stop` sin texto ni herramientas podría ser falsamente aceptada.

Otro riesgo original: al parsear `function.arguments`, un error de `JSON.parse` se traga y el agente continúa con `args={}`. Así puede intentar usar una herramienta con un contrato distinto del emitido.

Estas son vulnerabilidades de **validación del protocolo**, no causas demostradas de las dos ejecuciones fallidas de Gemma anteriores.

## Política nueva del adaptador experimental Cloudflare

En una respuesta de agente HTTP 200 no streaming:

- `finish_reason=length` conserva el tratamiento anterior de truncamiento (error local 422).
- `finish_reason=tool_calls` **requiere una lista no vacía** y cada llamada debe tener identificador único, nombre de función realmente declarado y `function.arguments` como **cadena JSON sintácticamente válida que representa un objeto no nulo**, con los campos `required` de nivel superior.
- `finish_reason=stop` **requiere texto visible no vacío y ausencia de llamadas a herramientas**.
- Se rechazan `choices` faltantes, `finish_reason` desconocidos, respuesta del asistente malformada, `tool_calls` de tipo no arreglo y cuerpo no JSON.
- El rechazo conserva **HTTP real de Cloudflare 200**, consumo de tokens/neuronas informado, hash y recuento de funciones; registra `status=PROVIDER_INVALID_RESPONSE`, `protocol_error_code` categórico y `client_http_status=422`. No se guarda el texto del modelo, los argumentos ni el prompt en los recibos.
- El adaptador devuelve **HTTP local 422** con código `BUFFALO_CF_PROVIDER_INVALID_RESPONSE`; no entrega la salida inválida al `AgentOrchestrator`, y **bloquea cualquier POST posterior de esa ejecución**.
- `interruptedTransport` comunica `status=provider_invalid_response` y `stopReason=CLOUDFLARE_PROVIDER_INVALID_RESPONSE` al runner: **no se ejecutan graders sobre políticas incompletas**.
- Si no puede parsearse el cuerpo, el metering se trata como **desconocido** (no cero); se retiene la reserva y se bloquean nuevas peticiones.

**Límites explícitos:** la compuerta solo comprueba integridad estructural, JSON, nombres registrados y claves `required` de nivel superior. **No es un validador JSON Schema completo**: las restricciones profundas, enums, arrays y semántica de cada herramienta quedan en el handler original. No afirmamos validar completamente ecuaciones, tipos o parámetros de un modelo SD.

Se aplica a ambos modelos del experimento, Gemma e Inkling, en la ruta de agente. La ruta de motores y el transporte histórico IGC permanecen sin cambios.

## Pruebas sin red ni inferencia

- `completion-policy-offline.mjs`: casos positivos `stop` y `tool_calls`; negativos `tool_calls` vacío, `stop` vacío, `content_filter`, `choices` faltante, JSON corrupto, argumento no objeto, campo obligatorio ausente, nombre desconocido, ID duplicado y demás violaciones. Verifica código local 422 y compuerta de grading.
- `mock-origin-preload.mjs` + `completion-transport-mock-offline.mjs`: HTTP 200 sintético con todos esos escenarios, preservación de neuronas medidas, fallos con metering desconocido, **un solo POST permitido tras detectar error**, y no alteración de las respuestas válidas. Conservar tests existentes de `finish_reason=length` y HTTP 499.
- Matriz CI sin credenciales reales Gemma + Inkling.

## Contratos que siguen pendientes

1. La primera respuesta de Gemma con thinking habilitado pudo incluir `reasoning`/`reasoning_content` que el `AgentOrchestrator` no persiste en el historial de herramientas. Este PR **no altera** la lógica original ni inyecta razonamiento sintético: se precisa capturar evidencia del proveedor si se desea volver a activar thinking.
2. Al empezar un *nuevo turno del usuario*, la normalización de historial original convierte roles a `user`/`assistant` y elimina metadatos de llamadas previas; ese problema no explica necesariamente un segundo POST dentro del mismo ciclo.
3. `chat_template.jinja` desplegado por Cloudflare y el origen del HTTP 499/6001 siguen sin confirmarse.
4. El ensayo live mínimo debe usar **`tool_choice` natural, sin `required`**, dos turnos como máximo, resultado de herramienta sintético y un presupuesto pequeño explícito; ninguna herramienta real será ejecutada. Es una prueba de compatibilidad, no una evaluación de política ni un resultado de Merlin.

No se deben repetir benchmarks SD completos ni elevar los límites de neuronas a partir de esta corrección. 
