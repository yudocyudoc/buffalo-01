# Gemma 4 / Buffalo — comparación de latencia entre API OpenAI-compatible y nativa

**Fecha:** 21 de noviembre de 2026, Ciudad de México  
**Modelo:** `@cf/google/gemma-4-26b-a4b-it`  
**Tipo:** diagnóstico de proveedor. **No es benchmark de la clínica ni evaluación de Merlin.**

## Antecedente contrastado

En la prueba anterior se ejecutó una conversación de **dos solicitudes** con Gemma 4: primero eligió `read_model_section({section:'specs'})` por sí mismo, después recibió un resultado sintético y finalizó con una frase correcta. Primera llamada: **714 ms**, ~18.79 neuronas. Segunda llamada, **no streaming**: **55,509 ms**, ~19.49 neuronas, 2,066 tokens de entrada y 26 tokens de salida. No se identificó la causa interna de esa latencia.

En un benchmark anterior de Buffalo, una sola solicitud grande a Cloudflare devolvió HTTP 499 / error 6001 tras aproximadamente 61 segundos, sin metering. **No se ha demostrado que ambas situaciones compartan causa.**

## Ensayos controlados de esta fase

Se tomó **el mismo JSON** de solicitud posherramienta, con seis herramientas cuyas descripciones proceden de Buffalo. Algunos esquemas JSON se redujeron deliberadamente y NO son idénticos a las declaraciones Zod completas del benchmark. La conversación incluye un `assistant.tool_calls` estructurado y su `role:'tool'` asociado, **sin ejecutar realmente una herramienta**. La solicitud contiene `stream:true`, `enable_thinking:false`, `max_completion_tokens:128`, sin `tool_choice:'required'`. Aquí se midió únicamente el turno posterior a herramienta, no un ciclo real completo de dos inferencias.

| Prueba | Ruta | Resultado | Duración total cliente | Tokens entrada/salida | Neuronas | Eventos SSE |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| S1 | `/ai/v1/chat/completions` | terminación `stop` | **1,258 ms** | **1,611 / 24** | **15.30** | **24** |
| S2 | `/ai/run/@cf/google/gemma-4-26b-a4b-it` | respuesta correcta; `[DONE]` | **967 ms** | **1,611 / 24** | **15.30** | **24** |

Observación en la ruta nativa: el campo `model` del primer evento SSE retornó `@cf/google/gemma-4-26b-a4b-it-external`, aunque el ID solicitado fue `@cf/google/gemma-4-26b-a4b-it`. **Un alias de serving no demuestra necesariamente proveedor externo, región de ejecución ni versión de plantilla**.

La conexión de Cloudflare utilizada aquí entregó el **texto SSE completo al terminar**. Por ello estos números son duraciones de la petición completa, no tiempos medidos al primer byte o token.

Se intentó además una petición **no-streaming** con el mismo JSON salvo `stream:false`, pero la herramienta conectada solo devolvió `{}`, sin usage, estado, error ni cuerpo. **Resultado no interpretable**: no permite afirmar éxito, error, duración ni consumo. No se repitió a ciegas y el consumo eventual se considera desconocido.

## Inferencia permitida y límites

1. **Ambos endpoints manejaron correctamente la continuación con herramientas bajo estas condiciones ligeras**, con los mismos tokens y neuronas y sin un 499 observable.
2. La latencia anómala de **55.5 s** del experimento anterior **no se reprodujo** en estas dos pruebas streaming. Esto no prueba causalidad del streaming: las solicitudes fueron más cortas (1,611 tokens vs. 2,066), no simultáneas y podrían existir factores de colas, variación de infraestructura o estado del servicio.
3. **La ruta nativa no mostró ventaja grande** frente a OpenAI-compatible en esta muestra (diferencia de 291 ms), pero con N=1 por ruta no tiene sentido hacer inferencia estadística de rendimiento.
4. **El tiempo hasta primer byte (TTFB), primer evento SSE y primer delta de contenido siguen SIN medir**. Los proxies de los conectores agregan el resultado. Para discriminar cola/prefill de generación se requiere leer el stream directamente con `fetch` desde Node y marcar cada llegada de bytes.
5. No hay evidencia de incompatibilidad general del historial `assistant.tool_calls`/ `role:tool` en este caso pequeño. No se ha probado el escenario completo con 22 herramientas, 19k tokens, múltiples vueltas y dinámica SD.

## Arnés de TTFB reproducible — preparado pero NO ejecutado

`scripts/cloudflare/gemma4-stream-ttfb-probe.mjs` usa `fetch` de Node con `ReadableStream` para medir, separadamente:

- Tiempo hasta cabeceras HTTP.
- Tiempo hasta primer byte recibido.
- Tiempo hasta primer evento SSE.
- Tiempo hasta primer `delta.content` útil.
- Duración total, `finish_reason`, modelo efectivo, eventos, uso total y hashes de solicitud/respuesta.

**Seguridad y presupuesto:** solo se ejecuta con `BUFFALO_PAID_RUN=I_ACCEPT_CLOUDFLARE_AI_COSTS`, cuenta y token; dos POST como máximo, secuenciales, `max_completion_tokens=128`, reserva inicial estimada **≤200 neuronas** para ambos; abortar tras error o metering desconocido y sin reintentos. Timeout local de **90 s** que es una salvaguarda del cliente, **no** prueba de ningún timeout del proveedor. Reserva local ≠ tope de facturación. No registra contenido del prompt, respuesta ni credenciales en el artefacto (solo hashes, métricas y estadísticas). **No está integrado en un workflow que dispare inferencias automáticas**.

Para ejecutarlo manualmente, solo con autorización de costos y credenciales ya disponibles en el entorno:

```bash
BUFFALO_PAID_RUN=I_ACCEPT_CLOUDFLARE_AI_COSTS \
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
node scripts/cloudflare/gemma4-stream-ttfb-probe.mjs
```

El script se valida sin red con `gemma4-stream-ttfb-offline.mjs` desde la matriz CI; ese test comprueba que no inicia nada sin opt-in.

## Decisión

**No repetir aún el benchmark completo de Merlin.** El siguiente experimento útil es recoger TTFB real con este arnés cuando corresponda (N=1 por endpoint), y solo ampliar el contexto después de disponer de ese dato. Ni el modelo original de Buffalo, ni su agente, ni el SD ni su grader se modificaron. No agregar streaming directamente al adaptador de producción sin verificar que el bucle manual OpenAI SDK lo puede consumir (el original espera un objeto de chat completion, no un iterador de eventos).

Fuentes: [Gemma 4 Workers AI](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [OpenAI-compatible API](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/), [Workers AI errors](https://developers.cloudflare.com/workers-ai/platform/errors/).
