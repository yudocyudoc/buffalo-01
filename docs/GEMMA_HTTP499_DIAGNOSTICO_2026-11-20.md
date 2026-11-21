# Gemma 4 — incidente HTTP 499 en la primera inferencia

**Fecha de ejecución:** 2026-11-20, 19:44–19:45 Ciudad de México (2026-11-21, 01:44–01:45 UTC).  
**Workflow:** [GitHub Actions #44851500139](https://github.com/yudocyudoc/buffalo-01/actions/runs/44851500139).  
**Commit probado:** `a9dafb7177dd399d5fdde207ce0f3d12c9458e91`.  
**Artefacto JSON original:** [evidencia #14684994725](https://github.com/yudocyudoc/buffalo-01/actions/runs/44851500139/artifacts/14684994725) (retención 7 días).

## Datos verificables

- **Agente/modelo/caso:** Merlin, `@cf/google/gemma-4-26b-a4b-it`, `policyImplementation/dialysisClinic`.
- **Tiempo dentro de `runAgent`:** 61,366 ms; duración del workflow completo cerca de 5 min 52 s, con instalación de dependencias antes de la inferencia.
- Se reservó **un solo POST**: `original-agent-chat-tools`, **HTTP 499**, respuesta JSON con error `AiError: Client Closed Request`, código de Cloudflare **6001**. No hubo ninguna respuesta HTTP 200, `finish_reason`, texto o tool call.
- `thinking_disabled: true` en el recibo confirma que nuestro adaptador preparó la petición con `chat_template_kwargs.enable_thinking=false`. **No demuestra que ese parámetro causara el 499.**
- **4000 neuronas** era el presupuesto local configurado; la reserva previa de **391 neuronas** se conservó como `unknown-charged-reservation-held-fail-closed`. La reserva **no es consumo real facturado**. Cloudflare no informó ni tokens ni neuronas de esta petición. Su consumo efectivo es **desconocido**.
- No se llamó a herramientas ni se modificó el modelo, y los tres graders no fueron ejecutados. Estos hechos **no evalúan la capacidad de Gemma para resolver la política**.
- El archivo de evidencia anterior mostró `stopReason=CLOUDFLARE_USAGE_UNAVAILABLE_FAIL_CLOSED`, que ocultaba el fallo primario HTTP 499, y `usageFromCloudflare.neurons=0`, confundiendo datos ausentes con consumo cero.

## Interpretación, con incertidumbre explícita

Cloudflare describe **HTTP 499** como cierre de una conexión por un cliente mientras se procesa la solicitud. En este caso, nuestro cliente de GitHub **sí recibió una respuesta JSON con estado HTTP 499** y `AiError ... code:6001`, por lo que **no se puede deducir únicamente de la definición genérica del 499 qué componente interno cerró la conexión**. La duración de ~61 s sugiere revisar tiempos límite, cola o respuesta lenta, **pero no prueba un timeout concreto de 60 segundos**, ni que GitHub haya cancelado el trabajo. El paso de GitHub continuó y guardó el artefacto.

Referencias oficiales: [Cloudflare HTTP 499](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-499/), [Workers AI error codes](https://developers.cloudflare.com/workers-ai/platform/errors/).

## Corrección de observabilidad (sin cambiar el comportamiento de inferencia)

- Registrar `request_elapsed_ms`, estado HTTP y código interno de proveedor (`provider_error_code`) en recibos; no almacenar contenido de prompts ni respuestas privadas adicionales.
- Tratar **HTTP 499 como error de proveedor primario**: `status=provider_http_error`, `stopReason=CLOUDFLARE_PROVIDER_HTTP_499`. La ausencia de medición sigue siendo información secundaria relevante.
- En el JSON de evidencia, `promptTokens`, `completionTokens`, `cachedPromptTokens` y `neurons` pasan a `null` si no hay medidas completas, no `0`. Las reservas permanecen separadas en `providerDiagnostics.neuronBudget`.
- Una prueba offline devuelve un JSON sintético `499`/código `6001` para comprobar categorización, metering desconocido y preservación de los límites. Se ejecuta en la matriz Inkling/Gemma junto con los demás casos.

**Esta PR NO modifica prompts, esquemas, motor SD, agente original, razonamiento (sigue deshabilitado para Gemma), cap de 4096 ni presupuestos. No ejecuta inferencias pagadas.**

## Próxima decisión

No es responsable recomendar otro benchmark completo de unos 6–7 minutos sin aislar primero este fallo. Un diagnóstico **futuro** podría comprobar con consentimiento explícito una única petición pequeña a Gemma (con y sin `enable_thinking`, en ejecuciones separadas), con herramienta sintética y salida de 128–256 tokens, preservando un cap bajo de neuronas y POST. Es una prueba del endpoint, **no un sustituto de Buffalo original**; solo después de probar compatibilidad se debería repetir el caso `dialysisClinic`. No se ha programado ni ejecutado esa inferencia.
