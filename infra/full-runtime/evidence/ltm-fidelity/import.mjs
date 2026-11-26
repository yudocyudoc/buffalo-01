import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const [matrixDir, diagnosticDir] = process.argv.slice(2);
if (!diagnosticDir) throw Error('Supply the extracted matrix and diagnostic artifact directories.');
const matrix = '45759559827', diagnostic = '45770076467';
const sources = [
  ['armsRace', diagnostic, '8a0b15665226c73776b9129a7704f683dbc7000c3831276dadb3387a675b80e2'],
  ['bassDiffusion', diagnostic, 'f5e991b0510cf847baa6f25dc7f2d8690b80791d345fb68e3a9c7991b3f6790b'],
  ['inventoryWorkforce', matrix, 'd440fde45252749a30f6ec38e21759525e287809a0fe057c714b7184b9c4707e'],
  ['predatorPrey', matrix, 'f8b29765563bececba528ab232d7296dbe1c153b967b0584419534b174cb1ae4'],
  ['marketGrowth', matrix, '07ed81158a9fd24c83991a9e2a917a87ed5800637a31b45c38d096dee9cdfc83'],
  ['maibab', matrix, '9cf18026b59edfea5782d1057f09225d0cd6613291c14ca78aaa4b9009f18481'],
  ['maibab-control', matrix, 'd0ac4f9f599c592eb074423eebe540ae152840be00c8259321c318df9a284f23'],
  ['maibab-perturbed', diagnostic, '3f549ff0c77cbbf24f85bcc01a8e63eb798a7e585abe5e2cd3246929c503d6ce'],
];

const corpus = sources.map(([name, workflow, sha256]) => {
  const bytes = readFileSync(join(workflow === matrix ? matrixDir : diagnosticDir, name + '.json'));
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw Error('Unexpected receipt: ' + name);
  const receipt = JSON.parse(bytes);
  const {record} = receipt.narratives[0];
  const {run_id, run_sha256, model_sha256, time, mode, periods, loops} = receipt.evidence;
  if (run_id !== record.run_id || run_sha256 !== record.run_sha256 ||
      model_sha256 !== receipt.run.model_sha256 || receipt.simulation_id !== run_id) throw Error('Run mismatch');
  const {feedbackLoops, dominantLoopsByPeriod} = receipt.feedback.content;
  return {name, workflow, sha256, run_id, run_sha256, model_sha256, series:receipt.run.series,
    evidence:{time, mode, periods, loops}, feedback:{feedbackLoops: feedbackLoops.map(({identifier,partition}) =>
      ({identifier,partition})), dominantLoopsByPeriod},
    narrative:record.output.textContent, descriptions:record.feedbackLoops, final:receipt.session.output};
});
writeFileSync(new URL('./corpus.json.gz', import.meta.url), gzipSync(JSON.stringify(corpus), {level:9}));
