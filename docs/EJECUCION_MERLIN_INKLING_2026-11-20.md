# Primera ejecución real de Merlin + Inkling 2 Small — diagnóstico y frontera de evidencia

**Fecha:** 2026-11-20  
**Repositorio:** `yudocyudoc/buffalo-01`  
**Commit ejecutado:** `bb666d18d7bbf76d30f82d9ca276e26827406039`  
**Workflow real:** [Run 44837247363](https://github.com/yudocyudoc/buffalo-01/actions/runs/44837247363)  
**Artefacto JSON:** [evidencia de la ejecución](https://github.com/yudocyudoc/buffalo-01/actions/runs/44837247363/artifacts/14679043022) (retención de 7 días).  
**Caso original:** `policyImplementation / dialysisClinic`. Agente `merlin`, proveedor Cloudflare, modelo `@cf/thinkingmachines/inkling-2-small`, harness PySD, máximo ocho POST.

## Conclusión principal

**No fue un fallo de autenticación ni un fallo de conectividad Cloudflare.** Las **8 peticiones registradas** por el bootstrap devolvieron **HTTP 200**. Las 8 respuestas finalizaron con `finish_reason=tool_calls` y en conjunto solicitaron **10 llamadas a herramientas** (recuento de Cloudflare, no evaluaciones de éxito).

El límite de **8 peticiones** del propio adaptador se agotó antes de que Merlin terminara; el SDK OpenAI-compatible envolvió el rechazo local del `fetch` como `Connection error.` y la ejecución terminó con código 2. El corte por presupuesto es la explicación consistente con el código y los ocho recibos; el PR que acompaña este informe añade un diagnóstico explícito y un caso de regresión offline para confirmarlo sin gasto.

## Evidencia observable en el log

El log nativo registra, en orden, los siguientes eventos `cloudflare Manual: tool call completed`:

1. `read_model_section`
2. `read_model_section`
3. `read_model_section`
4. `read_model_section`
5. `run_model`
6. `get_variable_data`
7. `read_file`
8. `edit_variables`
9. `get_current_model`
10. `run_model`

**Precisión:** el mensaje `tool call completed` confirma retorno del manejador, pero **no contiene por sí solo el flag `isError` ni los valores numéricos**. Los 10 eventos observados coinciden con el recuento de llamadas a funciones de las respuestas Cloudflare. El agente accedió al modelo, solicitó dos simulaciones, consultó variables y realizó una operación de edición de variables, pero **no hay evidencia suficiente de que la edición resolviera la política**.

**No se ejecutaron los tres graders** `meetsGoal`, `intact`, `sensible` porque `runAgent()` rechazó antes de devolver un modelo final. El artefacto original guarda `toolLog: []`, `evidence: {}` y `grades: []` en ese error. Eso describe un **problema de observabilidad del ejecutor**, no que el agente no hubiera utilizado herramientas.

## Uso de inferencia registrado por Cloudflare

Estos totales proceden de sumar los campos `usage` de las ocho respuestas HTTP 200 y **no constituyen una factura**:

| Dato | Total de ocho respuestas |
|---|---:|
| Solicitudes HTTP 200 | 8 |
| Solicitudes de herramientas devueltas por el modelo | 10 |
| Tokens de entrada informados | 209,302 |
| Tokens de salida informados | 1,692 |
| Tokens de entrada cacheados informados | 125,696 |
| `neurons` informados | ~3,576.67 |

**Precaución:** el logger de Buffalo imprime importes en USD como `[usage:openai]` porque no tiene tarifas para el proveedor `cloudflare` ni para Inkling. **Esos importes son estimaciones incorrectas usando los precios alternativos de OpenAI; no son el costo facturado por Cloudflare.** Para costos efectivos, consultar Workers AI Usage/Billing.

## Correcciones del PR

- El transporte cuenta intentos rechazados por presupuesto o duplicado en `diagnostics()`, aunque el SDK los transforme en errores genéricos. Los intentos bloqueados no crean recibos de inferencia adicional.
- El ejecutor categoriza `budget_exhausted` por el estado explícito del transporte, **no** por el texto `Connection error.`.
- Se conservan incluso en ejecuciones interrumpidas los **nombres de herramientas observadas** y la cantidad de llamadas pedidas por la IA. No se inventan flags de éxito, snapshots ni resultados cuando el evaluador original no los devuelve.
- El ejecutor registra por separado `usageFromCloudflare` sin asignar un importe monetario ficticio.
- El contrato offline llena el límite de cuatro intentos, bloquea el quinto sin red y verifica su diagnóstico.
- El workflow de pago conserva valor por defecto **8 POST**; para una nueva ejecución, el usuario puede seleccionar conscientemente **16 o 24** POST. **No hay rerun automático ni límite fijo de dólares.**

## Próximo experimento

Únicamente después de revisar el PR de diagnóstico y con **nuevo consentimiento manual**, ejecutar de nuevo un solo caso original `dialysisClinic` con Merlin e Inkling y un presupuesto elegido expresamente (16 puede ser una primera elección moderada; 24 podría ser necesario). La meta sigue siendo registrar `toolLog`, el modelo final, simulación y los tres graders del original.

**No atribuir a este run un éxito de política ni una recomendación empresarial validada.** Sí constituye evidencia positiva, por primera vez en el fork, de un agente original utilizando varias herramientas y el harness de simulación a través de Cloudflare Workers AI.
