# Primera ejecución nativa de Buffalo — infraestructura

**Fecha:** 2026-11-20  
**Repositorio base:** \`yudocyudoc/buffalo-01\`, fork de \`UB-IAD/sd-ai\`  
**Objeto:** ejecutar software original; no añadir una arquitectura alternativa.

## Por qué existe este smoke

La auditoría estática de Buffalo localizó agentes, motores, herramientas y simuladores, pero **no demostró que funcionaran instalados**. Este paso comprueba tres fronteras reales reutilizando el código upstream, sin modificar motores ni prompts:

1. Arranque real de \`app.js\` y respuesta de \`/status\`.
2. Conexión al servidor WebSocket y \`initialize_session\` → \`session_ready\`, confirmando el registro de Sócrates, Merlin, Themis y las dos configuraciones de Athena.
3. Conversión nativa SD-JSON → XMILE y ejecución mediante \`PySDSimulator\`. Modelo de stock de inventario: 10 unidades iniciales, +2/minuto de entrada y −1/minuto de salida durante 10 minutos; valor final esperado: 20.

**Este paso NO invoca agentes LLM, NO prueba llamadas a herramientas desde el razonamiento de un agente, NO ejecuta Loops That Matter, NO verifica Stella y NO demuestra capacidad empresarial.** Es una comprobación de que la infraestructura real está operativa antes de incurrir en costos.

## Cómo ejecutarlo localmente (instalación completa)

Trabajar en una copia limpia del fork. Node 22 y Python 3.11 son las versiones fijadas en el workflow dedicado; otras versiones pueden funcionar, pero no se les atribuirá compatibilidad sin ejecución.

\`\`\`bash
git clone https://github.com/yudocyudoc/buffalo-01.git
cd buffalo-01
npm ci
python3 -m pip install -r third-party/PySD-simulator/requirements.txt
npm test
node scripts/smoke-native.mjs
\`\`\`

- \`npm ci\` ejecuta el **postinstall original** con los componentes opcionales del proyecto; no se emplea \`npm run install:core\`.
- El \`postinstall\` devuelve código cero incluso si fallaron algunos componentes: **leer su resumen**. La instalación de PySD se repite de forma explícita porque es indispensable para esta comprobación.
- \`npm test\` es la suite original y se ejecuta por separado; este smoke no sustituye esa suite.
- El script inicia el \`app.js\` real en puerto local **31458**, confirma las herramientas de red y termina el servidor. No necesita claves API.
- **PowerShell/Windows:** la dependencia Python se instala con \`py -m pip install -r third-party/PySD-simulator/requirements.txt\` y el script puede ejecutarse con \`$env:BUFFALO_PYTHON = 'python'; node scripts/smoke-native.mjs\`. El trabajo con agentes en Windows no está aislado mediante bubblewrap; preferir Linux aislado para posteriores sesiones con herramientas.
- Verificar que el puerto 31458 esté libre, y no ejecutar el smoke como servidor público.

## Cómo ejecutarlo con GitHub Actions

El fork incorpora \`.github/workflows/native-smoke.yml\`, disparable por cambios del PR o manualmente tras integrar el workflow en \`main\`. No necesita secretos ni claves de LLM.

**Los workflows de un fork pueden estar deshabilitados por defecto.** Si no aparecen ejecuciones, abrir la pestaña **Actions** de \`yudocyudoc/buffalo-01\` y habilitar los workflows del fork. Que un workflow esté en el repositorio no significa que haya corrido.

El workflow instala las dependencias npm y PySD y ejecuta \`node scripts/smoke-native.mjs\`. No simular o inventar el resultado antes de ver su job y su log.

## Resultado y transición al siguiente nivel

| Hito | Estado actual |
|---|---|
| Código del smoke y workflow registrado en rama separada | Hecho |
| Sintaxis de script | Requiere check del workflow o instalación local |
| \`npm ci\` completo | No ejecutado aquí |
| Pruebas unitarias originales | No ejecutadas aquí |
| Arranque HTTP y sesión de agente | No ejecutados aquí |
| PySD y resultado de inventario | No ejecutados aquí |
| Agente original con LLM y herramientas conectadas | **Siguiente etapa; no acreditado** |
| Cliente Stella y LTM real | No ejecutados aquí |

Después de superar infraestructura, **no regresar a una prueba de prompt**. La siguiente demostración requiere una sesión de agente completo (Merlin/Themis/Sócrates según tarea) que realmente llame a herramientas para generar modelo, \`run_model\`, \`get_variable_data\`, corregir y volver a simular; usar el harness de evaluaciones original con PySD y registrar el \`toolLog\`. Comparar después con Stella y anotar diferencias en semántica o feedback. Probar una categoría de evaluación antes de usar las configuraciones masivas \`leaderboardAgent*\` por su costo.

## Archivos upstream consultados

- \`app.js\`, \`routes/health.js\`, \`agent/WebSocket.js\`
- \`agent/tools/builtin/clientInteractionTools.js\`, \`agent/config/\`
- \`utilities/SDJsonToXMILE.js\`, \`evals/utilities/simulator/PySDSimulator.js\`
- \`evals/README.md\`, \`package.json\`, \`third-party/install.js\`

El endpoint anunciado como \`/api/v1/agent\` en el README del agente no coincide con \`path: '/api/v1'\` configurado en \`app.js\`. El smoke prueba la ruta configurada en código; si falla, documentar la evidencia antes de corregir Buffalo.

**Regla de evidencia:** un PASS en infraestructura ≠ una sesión de modelado válida ≠ recomendaciones empresariales correctas.
