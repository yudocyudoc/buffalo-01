import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import SDJsonToXMILE from '../../utilities/SDJsonToXMILE.js';

const script = fileURLToPath(new URL('./native-ltm.py', import.meta.url));

export function nativeLtmServer() {
  let running = false;
  return createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/simulate') return res.writeHead(404).end();
    if (running) return res.writeHead(429).end();
    running = true;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) return res.writeHead(413).end();
        chunks.push(chunk);
      }
      const model = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const xmile = SDJsonToXMILE(model, {modelName: 'main'});
      const output = await new Promise((resolve, reject) => {
        const child = execFile(process.env.BUFFALO_SIMLIN_PYTHON || 'python3', ['-I', script],
          {timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 12 * 1024 * 1024,
           env: {...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1'}},
          (error, stdout) => error ? reject(error) : resolve(stdout));
        child.stdin.on('error', reject);
        child.stdin.end(JSON.stringify({xmile, saveStep: model.specs.saveStep}));
      });
      res.writeHead(200, {'content-type': 'application/json'}).end(output);
    } catch {
      res.writeHead(422).end('SIMLIN_EXECUTION_FAILED');
    } finally {
      running = false;
    }
  });
}
