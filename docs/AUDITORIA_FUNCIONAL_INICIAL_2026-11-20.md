# Buffalo completo — auditoría funcional inicial

**Fecha:** 2026-11-20  
**Repositorio:** `yudocyudoc/buffalo-01` (fork auténtico de `UB-IAD/sd-ai`)  
**Base inspeccionada:** `main` @ `58cfc86c8f2634401534fc89ff856f3f21c90bba`  
**Alcance:** inspección estática de código y documentación del fork. **No equivale a instalación ni a una prueba operativa.**

## Propósito

Conocer y ejecutar **Buffalo en su arquitectura original**, antes de añadir componentes de Arena IGC. El brazo B histórico utilizó `engines/quantitative/engine.js`; las pruebas posteriores de Sócrates examinaron principalmente el comportamiento conversacional. Ninguna de esas condiciones acredita una sesión de agente con cliente, ejecución de modelos y herramientas conectadas.

No integrar por ahora ATMS, OpenModelica, un brazo determinista, wrappers nuevos ni prompts modificados. Tampoco confundir «funciona el software», «simula las ecuaciones» y «el modelo representa correctamente el problema».

## Componentes localizados en el código

| Componente | Ubicación | Función | Estado |
|---|---|---|---|
| Motores originales | `engines/` | Generación cuantitativa/cualitativa, Seldon y otros motores | Código localizado; no ejecutado |
| Agentes originales | `agent/config/` | Merlin, Sócrates, Athena (SFD/CLD), Themis | Configuraciones localizadas; no ejecutadas |
| Servidor conversacional | `agent/WebSocket.js`, `app.js` | Sesiones, selección de agente, mensajes y herramientas | Código localizado; no conectado |
| Herramientas integradas | `agent/tools/BuiltInToolProvider.js` | Generar, leer/editar modelos, simular vía cliente, consultar corridas, feedback, visualizar, RAG | Registradas en código; disponibilidad condicionada por sesión, modelo y cliente |
| Evaluador de agentes | `agent/utilities/AgentEvalRunner.js` | Cliente simulado, trazas de herramientas y resultados por turno | Código localizado; no ejecutado |
| Simulación de evaluaciones | `evals/utilities/simulator/PySDSimulator.js` | Conversión SD-JSON → XMILE → PySD | Código localizado; no probado |
| Herramientas de análisis en evaluaciones | `evals/utilities/analysisTools.js` | Escenarios, sensibilidad, calibración/optimización en el harness | Disponibles de forma **condicional** por prueba; **no idénticas** a las de Stella |
| Frontend propio | `frontend/README.md` | Sitio estático de documentación, evaluaciones y leaderboards | **No** es un cliente interactivo para construir/simular modelos |

### Frontera fundamental: quién ejecuta las ecuaciones

**Uso interactivo del agente:** el servidor WebSocket mantiene la conversación y solicita `run_model`, `get_variable_data` y `get_feedback_information` al **cliente**. El cliente es dueño del modelo SD-JSON, corridas y resultados; `createRunModelTool` emite la solicitud y espera la respuesta. El servidor no realiza por sí solo esa simulación de producto.

**Evaluaciones internas:** `AgentEvalRunner.js` sustituye al cliente real con un cliente de pruebas. Convierte SD-JSON a XMILE, ejecuta `PySDSimulator`, registra corridas y devuelve resultados. En ausencia de datos de feedback provistos por la prueba, su ruta de feedback puede construir una enumeración de bucles a partir de relaciones: **esto no acredita la equivalencia con Loops That Matter de Stella**.

**Stella y CoModel:** aparecen como integraciones/clientes del proyecto. El fork por sí solo **no incluye ni instala Stella**. Los subtipos de cola, horno y conveyor están definidos en SD-JSON, pero su fidelidad en el harness PySD y en cada cliente debe verificarse, no presumirse.

## Agentes: diferencias relevantes para nuestro objetivo

- **Sócrates** (`socrates.md`, `manual`): delimitar el problema mediante preguntas antes de modelar; validar un SFD mediante corrida; no visualizar ni solicitar análisis de feedback automáticamente fuera de las condiciones del proceso.
- **Merlin** (`merlin.md`, `sdk`): modelador orientado a construir y modificar estructuras; tiene habilitadas herramientas de escritura en sandbox por su configuración.
- **Athena** (`athena_SFD.md`, `manual`): construir gradualmente a partir de una hipótesis dinámica; una estructura/bucle a la vez.
- **Themis** (`themis.md`, `sdk`): proceso explícito de evidencia estructural y conductual, datos medidos, calibración y contraste de políticas. Su metodología escrita es relevante para el objetivo de IGC, **pero aún no se ha evaluado su ejecución**.

Las herramientas ofrecidas no son iguales en cualquier sesión: hay filtros por modo SFD/CLD, estado del modelo, permisos del agente, compatibilidad del cliente y capacidades registradas. Listarlas en el código no demuestra que hayan podido ejecutarse.

## Puesta en marcha reproducible: instalación completa, no `install:core`

La referencia original es [README.md](../README.md#setup). Para ejecutar el sistema completo, **no** usar `npm run install:core`, porque omite componentes requeridos por muchas evaluaciones. La instalación completa intenta instalar dependencias opcionales; algunas pueden fallar y el script `postinstall` termina con código cero incluso si fallaron: hay que revisar su salida.

### Entorno recomendado para primera ejecución

El workflow nativo `.github/workflows/test.yml` utiliza **Node 22.x**, **Python 3.x** y Ubuntu; ese es un punto de partida reproducible. Parte del sistema usa Go 1.24+ (`causal-chains`) y Docker/Podman (`test-simlin-agent`). Python también interviene en PySD y el motor de visualizaciones.

En Windows, el README advierte que los workers pueden funcionar **sin sandbox de filesystem**. Para probar agentes con permisos de escritura o herramientas externas, preferir un Linux aislado con `bubblewrap`; evitar exponer el servidor a internet o ejecutarlo con acceso a archivos sensibles. No dar por garantizado que `bubblewrap` funcionará en cualquier configuración de WSL.

### Secuencia local propuesta (shell Linux)

```bash
git clone https://github.com/yudocyudoc/buffalo-01.git
cd buffalo-01
git rev-parse HEAD
node --version
python3 --version
npm ci
python3 -m pip show pysd
```

- Revisar todas las líneas del `postinstall`; confirmar PySD y las dependencias relevantes, no inferir éxito solo de `npm ci`.
- Configurar un `.env` **local y sin subirlo** siguiendo el README. No es necesario habilitar todos los proveedores, pero el agente y los motores usados necesitan credenciales válidas. En `config.js` el proveedor de agente por defecto es **Anthropic**; Gemini y varias marcas mediante OpenRouter están configuradas. **La sección `openai` nativa está comentada en esta revisión**, aunque el README muestre la variable opcional.
- Ejecutar `npm test` y conservar resumen, fallos y entorno.
- Ejecutar `npm start`. Comprobar `http://localhost:3000/status` y `http://localhost:3000/api/v1/engines`; no asumir que la respuesta HTTP implica que los agentes funcionan.

**No lanzar de entrada los tres experimentos `leaderboardAgent*`:** el propio `evals/README.md` advierte de un costo aproximado de **USD 600–1,150** para ese barrido. Empezar por pruebas unitarias y una sola categoría/configuración de agente después de revisar el costo y habilitar sus API keys. El preset `careful.json` está configurado para `causal-decoder`, **no** para probar Sócrates; `test-agent-sfd.json` selecciona Merlin, no Themis.

## Hallazgos que deben verificarse antes de una sesión real

1. **Discrepancia de endpoint WebSocket:** `agent/README.md` anuncia `ws://localhost:3000/api/v1/agent`, pero `app.js` configura el `WebSocketServer` con `path: '/api/v1'` y lo imprime así en el log. Comprobar con una conexión real cuál ruta funciona; no modificar código sin reproducir el fallo.
2. **El backend no sustituye a Stella:** `frontend/` solo documenta. Para probar el ecosistema interactivo completo hace falta un cliente que implemente las respuestas a `get_current_model`, `run_model`, `get_variable_data` y feedback, o utilizar Stella/otro cliente compatible. El harness PySD cubre evaluaciones internas, no toda la experiencia de producto.
3. **Diferencia entre motor de simulación y verificación científica:** una corrida sin errores no demuestra validez estructural, identificación de parámetros ni capacidad predictiva. Registrar las tres por separado.
4. **Dependencias silenciosamente omitidas:** `third-party/install.sh` y `install.bat` reportan componentes fallidos pero devuelven estado cero. Inspeccionar y registrar qué se instaló.
5. **No confundir análisis LTM con enumeración de bucles:** el harness puede devolver `findFeedbackLoops` cuando la prueba no inyecta feedback. Esto no debe presentarse como dominancia cuantificada por Stella.

## Primera demostración exigible (sin cambiar metodologías)

Una corrida de agente completa, idealmente en un cliente nativo compatible, debe dejar **evidencia observable** de:

1. `initialize_session` y `select_agent` aceptados (nombre, proveedor, modo y versión).
2. Problema y límites formulados por el agente original.
3. Modelo SD-JSON generado, con sus ecuaciones, unidades y supuestos.
4. Solicitud `run_model` y **respuesta real** del simulador, con identificador de corrida y errores/warnings.
5. `get_variable_data` para stocks y flujos clave; pruebas de conservación, no-negatividad y comportamiento.
6. Revisión del modelo si falla, preservando estado anterior y trazas de herramientas.
7. Análisis de feedback/LTM **solo si la fuente de feedback está identificada**, con sus limitaciones.
8. Estado final: **ejecutable**, **consistente**, **ajusta datos**, **predice** y **recomienda políticas** como propiedades independientes; marcar «no evaluado» donde falte evidencia.

No introducir todavía Q75, cafetería ni protocolos de Arena como requisitos de ejecución. Primero lograr una demostración nativa completa; después utilizarlos como casos externos.

## Registro de estado

| Evidencia | Estado a 2026-11-20 |
|---|---|
| Fork auténtico y SHA upstream idéntica | **Verificado** vía metadatos GitHub |
| Inspección de rutas, agentes, herramientas y evaluadores | **Realizada** |
| Instalación con dependencias completas | **No ejecutada** |
| Tests unitarios | **No ejecutados** al redactar este informe |
| Servidor HTTP/WebSocket | **No ejecutado** |
| Agente con herramientas y simulación real | **No ejecutado** |
| Conexión con Stella | **No verificada** |
| Resultado científico o empresarial | **Ninguno atribuido** |

### Fuentes dentro del fork

- [README](../README.md)
- [WebSocket agent](../agent/README.md)
- [Configuraciones de agentes](../agent/config/)
- [Herramientas integradas](../agent/tools/BuiltInToolProvider.js)
- [Llamadas al simulador del cliente](../agent/tools/builtin/clientInteractionTools.js)
- [Harness de agente](../agent/utilities/AgentEvalRunner.js)
- [Evaluaciones y costos](../evals/README.md)
- [Frontend: alcance real](../frontend/README.md)
- [Configuración activa de proveedores](../config.js)
- [Workflow de pruebas](../.github/workflows/test.yml)

**Regla de interpretación:** «el repositorio implementa X» solo implica código localizado. «X funciona» exige ejecución y evidencia de salida. «X sirve para decidir» exige prueba conductual con datos pertinentes, no solo una simulación exitosa.
