# Comparación Cloudflare: Gemma 4 vs Inkling 2 Small con Buffalo original

**Estado:** instrumentación en rama experimental; **cero inferencias pagadas en este PR**.  
**Fuentes:** modelos y precios [Gemma 4 26B A4B](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [Inkling 2 Small](https://developers.cloudflare.com/workers-ai/models/inkling-2-small/) y [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/). Consultadas 2026-11-20.

## Objetivo

Comparar en `policyImplementation / dialysisClinic` al **mismo agente original Merlin** con los **mismos prompts, herramientas, modelo SD inicial, simulador PySD y tres graders** que Buffalo usa:

1. `meetsGoal`: ¿la lista de espera simulada cumple el objetivo (≤ 80)?
2. `intact`: ¿se respetaron las restricciones protegidas del dominio?
3. `sensible`: ¿el comportamiento de la intervención es plausible según el evaluador original?

La variable experimental es el **modelo de inferencia**. La comparación es **exploratoria**, porque cada ejecución LLM puede tomar caminos diferentes y la herramienta de evaluación añade el modo no interactivo de Buffalo. Una ejecución por modelo no estima fiabilidad estadística.

## Dos modelos

| Modelo de Cloudflare | Precio USD/M tokens entrada | Precio USD/M tokens salida | Caché entrada | Contexto | Tools |
|---|---:|---:|---|---|---|
| `@cf/thinkingmachines/inkling-2-small` | 0.30 | 1.00 | 0.10/M | 1,048,576 | Sí |
| `@cf/google/gemma-4-26b-a4b-it` | 0.10 | 0.30 | no hay tarifa independiente publicada en la ficha | 256,000 | Sí |

**No suponer que Gemma produce menos tokens.** Es más barata **por unidad**, pero el total depende de las rondas, longitud del contexto, razonamiento y calidad de las herramientas. Gemma con function calling está documentado; su uso concreto con los esquemas grandes de Buffalo no está validado todavía.

## Qué cambia y qué no

El único cambio de proveedor se hace en `scripts/cloudflare/active-model.mjs` con la variable `BUFFALO_CF_MODEL_ID` y una **lista cerrada de dos valores**. El modelo elegido se aplica simultáneamente al agente en la API compatible con OpenAI y al motor por la adaptación histórica IGC hacia `/ai/run`. No se modifica nada en `AgentOrchestrator`, `LLMWrapper`, `AgentEvalRunner`, prompts, ecuaciones, simulador ni evaluadores originales.

Se añade el **mismo límite de 4096 tokens de salida por respuesta del agente para ambos modelos** en el adaptador experimental. Los motores conservan su máximo original de 16,000 en IGC. El límite es necesario para proyectar un costo finito por petición; podría reducir la calidad de respuestas especialmente largas. Se registra como parámetro del experimento.

## Presupuesto de neuronas local

El workflow manual cuenta con **dos límites independientes**:

- `max_posts`: máximo estricto de **8, 16 o 24** peticiones HTTP de inferencia reservadas. Por defecto, 8.
- `max_neurons`: **2,000, 4,000 o 6,000** neuronas de admisión estimadas **por ejecución**, por defecto 4,000.

Antes de llamar a Cloudflare, el adaptador toma el JSON del request completo (incluidos esquemas de herramientas), estima tokens con `gpt-tokenizer`, aumenta 40 % más 512 tokens de margen, supone que **ningún token de entrada está cacheado**, reserva el máximo de tokens de salida (4096 para agente / 16000 para motor) y añade 10 % de margen a la reserva monetizada en neuronas según las tarifas del modelo seleccionado.

Si **neuronas acumuladas del proceso + reservas de llamadas en curso + reserva proyectada** superan `max_neurons`, **no envía la nueva petición**. Cuando Cloudflare responde, sustituye la reserva por el valor `usage.neurons`. Si el proveedor no informa neuronas pero sí tokens, estima con los precios publicados. Si no hay métricas o la solicitud tiene un resultado incierto, retiene la reserva como consumo posible **y bloquea nuevas inferencias**.

**Limitaciones importantes de seguridad de costo:**

- La reserva es una **estimación con márgenes, no una cota matemática garantizada**: el tokenizador real, el razonamiento oculto y los cargos de una llamada concreta pueden superar la reserva antes de que sepamos el consumo.
- Un mismo día puede haber consumo simultáneo de BCP, IGC u otras aplicaciones de Cloudflare. Este presupuesto **no lee ni limita el total diario de la cuenta**; se limita a este proceso de GitHub Actions.
- Workers Paid permite consumir **más de las 10,000 neuronas diarias gratuitas** y factura el exceso. El reset es a las 00:00 UTC. **Ni 4,000 neuronas locales ni 8 POSTS son un límite monetario garantizado**.
- Al fallar o terminar, la evidencia registra modelo, tokens, neuronas reportadas, posibles estimaciones y motivos de detención. No mezcla tarifas ficticias de OpenAI con costos de Cloudflare.
- Las pruebas CI offline **no usan el token de producción** y evitan toda inferencia.

## Ejecución sin inferencias

El workflow `.github/workflows/cloudflare-offline-contract.yml` corre una matriz **Gemma × Inkling** y valida:

- Registro del mismo modelo efectivo en conversación, motores y recibos.
- Enrutamiento con la adaptación IGC intacta y bloqueo total antes de la red.
- Precios unitarios y caché, cobro real de `usage.neurons`, bloqueo por presupuesto previsto y fail-closed si falta metering.
- Sintaxis del runner, del presupuesto y del comparador.

El resultado offline **no garantiza** compatibilidad live de Gemma con todas las funciones de Buffalo.

## Ejecuciones reales (requieren dos autorizaciones manuales)

**Solo después de fusionar este PR a `main`**, abrir [workflow de agente](https://github.com/yudocyudoc/buffalo-01/actions/workflows/paid-agent-case.yml). Mantener el mismo conjunto de parámetros salvo el modelo:

| Parámetro | Run A | Run B |
|---|---|---|
| Branch | `main` | `main` |
| `agent` | `merlin` | `merlin` |
| `case_index` | `0` | `0` |
| `model` | Inkling 2 Small | Gemma 4 26B A4B |
| `max_posts` | `16` | `16` |
| `max_neurons` | `4000` | `4000` |
| `consent` | `I_ACCEPT_CLOUDFLARE_AI_COSTS` | `I_ACCEPT_CLOUDFLARE_AI_COSTS` |

Cada ejecución necesita un clic separado de `Run workflow`. No hay autosecuenciación ni llamadas pagadas automáticas. Para una primera comprobación más económica se puede comenzar con Gemma y dejar Inkling para cuando se considere el gasto acumulado de la cuenta. **Se necesita autorización por ejecución.**

## Comparar resultados

Descargar los JSON de evidencia de los artefactos de cada run de GitHub Actions, extraerlos localmente y ejecutar:

```bash
node scripts/compare-cloudflare-runs.mjs /ruta/run-inkling.json /ruta/run-gemma.json
```

La tabla resultante muestra modelo, terminación, POSTS, neuronas, tokens, herramientas observadas y resultados exactos de `meetsGoal`, `intact`, `sensible`. Un criterio no evaluado se marca **not evaluated**, jamás fallido. Una comparación de eficiencia requiere además comprobar que la tarea fue terminada y que la evaluación se ejecutó.

El anterior [run #44837247363](https://github.com/yudocyudoc/buffalo-01/actions/runs/44837247363) sigue siendo **evidencia parcial de Inkling**, con 8 POSTS, 3576.67 neuronas, herramientas ejecutadas y **sin evaluaciones** porque cortó el límite de peticiones. Se puede visualizar junto a nuevas ejecuciones, pero no utilizarlo para afirmar una calidad comparativa.
