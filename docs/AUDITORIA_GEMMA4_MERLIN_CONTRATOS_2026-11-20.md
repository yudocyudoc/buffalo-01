# Auditoría de compatibilidad Gemma 4 ↔ Merlin / Buffalo

**Fecha:** 20 de noviembre de 2026 (Ciudad de México).  
**Código base auditado:** `806f731b50fb93c6a09e4deedd1b05bcb83d1d3f` (`main` al comenzar el trabajo).  
**Escenario:** `policyImplementation/dialysisClinic`; agente original `merlin`, modo `sfd`, modelo inicial original y **sin** `analysisTools`.  
**Alcance:** contrato Zod → JSON Schema, historial OpenAI-compatible, uso de razonamiento, parseo de resultados y clasificación de éxito. **Cero llamadas de inferencia y cero neuronas.**

## Resumen ejecutivo

1. **No se reproduce la sospecha de JSON Schema `anyOf`/`oneOf`/`$ref`/`$defs` en los esquemas reales del caso.** La exportación real `toJSONSchema()` produjo 22 herramientas y **0** ocurrencias de esas construcciones, `allOf`, `const`, `not`, uniones de `type` o `patternProperties`. Un reporte sobre compatibilidad con JSON Schema no constituye evidencia de que esa incompatibilidad esté presente aquí.
2. **La declaración de herramientas es extensa:** **55,978 caracteres** de JSON para las 22 herramientas, incluyendo **37,008** caracteres de esquemas y **16,769** de descripciones; el resto es envoltura de los nombres y el protocolo. `edit_variables` domina la carga: 15,810 caracteres de esquema y 4,673 de descripción. Son **caracteres**, no tokens ni contexto total. Se requiere medir el request real para saber el costo de prefill.
3. **Dentro del ciclo vivo de herramientas**, Merlin conserva `assistant.tool_calls` con sus `id`, `function.name`, `function.arguments`, seguidos de `role:'tool'` con el `tool_call_id` correcto. El `hydrateMessagesForOpenAi` conserva esos campos sin alterarlos. El formato OpenAI habitual es correcto del lado cliente; el backend Cloudflare debe traducirlo.
4. **Se pierde `reasoning`/`reasoning_content`** al guardar respuestas con `tool_calls`. Esto es **riesgo de continuidad** si se permite thinking, según la excepción oficial de Google para un mismo turno de herramientas. No hay evidencia de si el primer proveedor emitió esos campos, porque los recibos de la prueba no conservaron el cuerpo de la respuesta.
5. **Existe una compuerta de éxito incompleta:** si Cloudflare devuelve `finish_reason:'tool_calls'` con `message.tool_calls:[]` y contenido vacío —forma documentada por un reportante en `cloudflare/ai#561`— el adaptador no marca truncamiento, y Merlin entra en la rama de **éxito sin herramientas**. La corrección previa solo rechaza `finish_reason:'length'`. Este riesgo está sustentado por el código, aunque esa forma exacta no se observó en las dos ejecuciones de Buffalo.
6. **Argumentos malformados:** el bucle de Merlin hace `JSON.parse(tc.function.arguments)`, pero un parseo fallido deja `args={}` y **ejecuta igualmente** el nombre de la herramienta. Un contrato corrupto no se rechaza explícitamente; puede producir errores en un handler o acciones inesperadas. Es un defecto preventivo de validación, no una demostración de que haya ocurrido en las pruebas.
7. **Se pierde la semántica de herramientas al iniciar un nuevo turno de usuario:** la normalización inicial convierte cualquier rol distinto de `assistant` o `system` en `user` y conserva solo `role`+`content`; borra `tool_calls`, `tool_call_id` y `reasoning`. Es un problema de continuidad **entre turnos de usuario**, pero no explica directamente la segunda petición del **mismo** ciclo de herramientas, que se forma sin esa normalización inicial.
8. **El HTTP 499 a los ~61 s es otro incidente:** ocurrió en la primera petición, antes de cualquier herramienta, sin métricas de consumo. Ningún bug de post-`tool_response` permite inferir causalmente ese 499. La versión exacta de la plantilla desplegada por Cloudflare y su causa interna siguen desconocidas.

## Método y reproducción

El archivo [`scripts/cloudflare/audit-gemma4-merlin-schemas-offline.mjs`](../scripts/cloudflare/audit-gemma4-merlin-schemas-offline.mjs) importa el **`BuiltInToolProvider` original**, `isToolActive` y el **`groups.policyImplementation` original**. Selecciona `dialysisClinic`, construye un contexto de sesión `sfd` equivalente al definido por `AgentEvalRunner` y exporta cada `inputSchema.toJSONSchema()`. El mismo script verifica la integridad de un historial sintético `assistant.tool_calls` → `tool` con `hydrateMessagesForOpenAi`, y prueba los estados anómalos sin ejecutar herramientas.

No se instanció `AgentOrchestrator` ni se lanzó un agente: hacerlo iniciaría partes del harness no necesarias. No se ha capturado el request completo de ~19k tokens de un run real; ese contenido **no está disponible** en los recibos anteriores, que conservan hashes, usos y metadatos para limitar exposición de información.

En GitHub Actions, la matriz de contratos offline ejecuta el audit script con ambas selecciones de modelo. Como el generador de herramientas es el mismo, ambas deben producir las mismas métricas. En esta prueba se obtuvieron los mismos resultados.

### Inventario cuantitativo

| Métrica | Valor observado |
| --- | ---: |
| Herramientas activas de Merlin / `sfd` | **22** |
| Herramientas dinámicas registradas por este caso | **0** |
| Tamaño del arreglo `tools` serializado | **55,978 caracteres** |
| Esquemas JSON (`parameters`) | 37,008 caracteres |
| Descripciones de herramientas | 16,769 caracteres |
| `anyOf`, `oneOf`, `allOf`, `$ref`, `$defs`, `const`, `not`, `patternProperties` | **0** |
| `type` como arreglo de tipos | **0** |
| Propiedades de usuario llamadas `type` o `description` | **5** |
| Esquema `edit_variables` | **15,810 caracteres** |
| Descripción `edit_variables` | **4,673 caracteres** |
| Esquema `edit_specs` | 3,352 caracteres |
| Esquema `create_visualization` | 3,266 caracteres |
| Esquema `edit_relationships` | 2,446 caracteres |
| Esquema `draw_causal_loop_diagram` | 2,084 caracteres |
| Esquema `read_model_section` | 1,624 caracteres; descripción de 3,757 |

El conjunto real contiene `generate_quantitative_model`, `discuss_model_with_seldon`, `discuss_model_across_runs`, `generate_ltm_narrative`, `discuss_with_mentor`, `get_feedback_information`, `get_current_model`, `update_model`, `run_model`, `get_run_info`, `get_variable_data`, `create_visualization`, `draw_causal_loop_diagram`, `read_model_section`, `edit_variables`, `edit_relationships`, `edit_specs`, `edit_modules`, `read_file`, `write_file`, `edit_file` y `search_documents`.

Las cinco coincidencias de nombres `type`/`description` están en `create_visualization` (dos), `draw_causal_loop_diagram`, `edit_variables` y `edit_specs`. **No se concluye pérdida de esas propiedades.** En la plantilla canónica actual, el filtro `standard_keys` se aplica solo al *fallback* de mapas sin estructura explícita de `properties`, no indiscriminadamente a todos los `properties` de un JSON Schema.

## Auditoría del protocolo, con severidad

| ID | Estado | Evidencia | Importancia / alcance |
| --- | --- | --- | --- |
| P-01 | **Riesgo de falso éxito comprobado en código** | `completion-policy.mjs` solo reconoce `length`; `AgentOrchestrator.js:3354-3359` considera cualquier respuesta sin `tool_calls` un éxito | **Alta.** Rechazar `finish_reason:'tool_calls'` sin llamadas, y evaluar `stop` vacío antes de devolver éxito |
| P-02 | **Pérdida de campos comprobada** | `AgentOrchestrator.js:3362-3366` guarda `content` y `tool_calls`, no `reasoning`/`reasoning_content` | **Alta si thinking está activado**, aún sin demostrar efecto observable en este incidente |
| P-03 | **Validación incompleta comprobada** | `AgentOrchestrator.js:3373-3380` captura `JSON.parse` inválido y sigue con `{}` | **Alta.** Rechazar antes de invocar herramientas; no ejecutar con argumentos sustituidos |
| P-04 | **Pérdida al iniciar siguiente mensaje comprobada** | `AgentOrchestrator.js:3184-3198` convierte `tool` a `user` y elimina metadatos | **Media.** Solo afecta continuidad entre turnos del usuario, no el ciclo de herramientas que ocurrió en la primera ejecución |
| P-05 | **Contrato del cliente confirmado; conversión proveedor no verificable** | `AgentOrchestrator.js:3365,3393` conserva arguments como string, `tool_call_id`; la plantilla canónica de Google exige `function.arguments` como mapa | **Media.** OpenAI-compatible usa string; Cloudflare tendría que deserializar antes de aplicar la plantilla. No convertir a objeto en el cliente OpenAI sin revisar compatibilidad |
| P-06 | **Carga cuantificada; causa no demostrada** | 22 herramientas, 55,978 caracteres; `edit_variables` es la mayor | **Media.** Diseñar pruebas separadas de complejidad de herramientas y longitud de conversación |
| P-07 | **Revisión de servidor desconocida** | No hay metadatos de versión de `chat_template.jinja` en las respuestas de Cloudflare | **Pendiente.** Consultar soporte/observabilidad del proveedor; no afirmar qué parche está desplegado |

### Distinciones esenciales

**Dentro de un turno:** se conserva `assistant.tool_calls → role:tool`. Esto es consistente con la rama de *forward-scan* OpenAI de la plantilla canónica que enlaza `tool_call_id` con `function.name`.

**Entre turnos de usuario:** la rutina de normalización inicial modifica el historial a `role` y `content` y por eso no preserva la estructura de las llamadas antiguas. Este segundo problema existe, pero no debe mezclarse con el primero.

**Razonamiento:** el formateador `hydrateMessagesForOpenAi` sí preservaría esos campos **si ya estuvieran presentes**. Se pierden antes, durante la construcción de mensajes en `processOpenAiManualResponse`. No se sabe si el primer resultado de Gemma realmente incluía contenido en `reasoning`.

**Argumentos:** `JSON.stringify`/string JSON es correcto en el contrato **OpenAI Chat Completions**. La plantilla directa de Google sí exige objeto. La traducción es responsabilidad del adaptador de serving; ninguna inferencia actual verifica su tratamiento exacto en Cloudflare.

## Incidentes previos y alcance causal

- **Primera ejecución Gemma, thinking activado:** herramienta `read_model_section` completada y segunda generación truncada exactamente en 4,096 tokens; la protección del transporte rechazó posteriormente esos casos, pero no recupera el contenido anterior. P-02 es una explicación **posible**, no probada.
- **Segunda ejecución Gemma, thinking desactivado:** primer POST devuelve HTTP 499 / error 6001 tras aproximadamente 61 segundos. **Cero** respuestas completadas; tokens/neuronas reales **desconocidos**. P-02, P-03 y el bug de plantilla posherramienta **no** explican directamente un fallo anterior a cualquier herramienta.
- **Prueba mínima y prueba de 6 herramientas:** se demostró compatibilidad básica con `tool_choice:'required'`, pero esas pruebas **forzaban** una llamada. El Merlin original no envía `tool_choice:'required'`; esa diferencia invalida afirmar equivalencia completa de comportamiento.

## Contraste con la documentación y reportes

**Plantilla canónica Google:** https://huggingface.co/google/gemma-4-26B-A4B-it/blob/main/chat_template.jinja — `format_parameters`, `format_function_declaration`, `forward-scan` de `role:'tool'` y validación `arguments` tipo mapa. **No se conoce** la revisión desplegada en Cloudflare.

**Guía Google de razonamiento:** https://ai.google.dev/gemma/docs/capabilities/thinking — quitar razonamiento entre turnos normales; **preservarlo dentro de una misma secuencia de tool calls**, cuando exista.

**Issue `google-deepmind/gemma#829`:** https://github.com/google-deepmind/gemma/issues/829 — reporte abierto sobre ausencia de un delimitador de canal después de `tool_response` con `enable_thinking=false`; el autor reprodujo en su propia instalación vLLM. **No explica por sí mismo el primer run con thinking activado ni el 499 antes de herramientas.**

**Issue `cloudflare/ai#561`:** https://github.com/cloudflare/ai/issues/561 — reporte abierto de un usuario sobre `tool_choice:'required'` con contexto largo, `finish_reason:'tool_calls'` pero `tool_calls:[]` y respuestas no-stream vacías. Relevante **directamente para proteger el parser de Buffalo**; no es prueba de que el incidente haya ocurrido aquí.

**Issue `cloudflare/cloudflare-docs#29731`:** https://github.com/cloudflare/cloudflare-docs/issues/29731 — discrepancia reportada 128K vs 256K. Ningún request de Buffalo documentado hasta ahora alcanzó esos límites.

## Recomendaciones ordenadas, sin modificar todavía producción

1. **Compuerta del adaptador ante respuestas incompatibles**: HTTP 200 + `finish_reason:'tool_calls'` con cero calls, o `finish_reason:'stop'` con texto vacío y ninguna call, debe quedar registrado como `provider_invalid_response`, sin ejecutar graders ni marcar éxito. No inventar reintentos.
2. **Validación de `function.arguments` antes de ejecutar**: deben ser JSON válido y un objeto de argumentos permitido; nunca sustituir errores de parseo por `{}`. Preferir compuerta en adaptador experimental y pruebas sintéticas para no cambiar el código original del agente.
3. **Comparativa de continuidad sin red**: comprobar qué pasa con `reasoning`/`reasoning_content` en `assistant.tool_calls` y con el formato del historial, distinguiendo las rutas thinking=true y false.
4. **Prueba controlada posterior a herramienta, con costo mínimo**, con `tool_choice:'auto'` o sin campo (como en el original), dos peticiones como máximo, sin motor PySD, salida limitada a 256 tokens y presupuesto explícito. Debe medir respuesta del segundo turno, no solo la primera selección. Necesita autorización nueva.
5. **Descomposición de complejidad**: (A) 22 herramientas y mensaje corto, (B) seis herramientas y mensaje largo. No usar un primer experimento de 180 segundos con el request completo como prueba inicial, y no atribuir un 499 a un timeout fijo sin evidencia.

## Criterios para cerrar la auditoría

**La auditoría estática es reproducible.** No cierra la incertidumbre sobre cómo Cloudflare renderiza la plantilla de Gemma internamente o qué originó el 499. Para declarar compatibilidad de agentes se necesitará un test live con `tool_choice` natural, dos turnos y respuestas validadas, y solo después una nueva ejecución del caso completo con graders originales.

**No alterar** Merlin, los modelos SD, los evaluadores y los presupuestos durante este PR. Las correcciones de transporte deben ser PR independiente con tests offline negativos antes de pedir otra inferencia.
