/**
 * Run ONE original Buffalo policyImplementation scenario with a full original agent.
 * Uses AgentEvalRunner and the upstream PySD client simulation harness, not Arena.
 * Manual paid opt-in required. No custom agent prompts or engine code.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { groups, evaluate } from '../evals/categories/policyImplementation.js';
import { runAgent } from '../agent/utilities/AgentEvalRunner.js';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const provider = 'cloudflare';
if (globalThis.__buffaloCloudflare?.provider !== provider) {
  throw new Error('BUFFALO_CLOUDFLARE_BOOTSTRAP_REQUIRED: launch with node --import ./scripts/cloudflare/bootstrap.mjs');
}
const agentName = process.env.BUFFALO_AGENT || 'merlin';
const supportedAgents = new Set(['merlin', 'themis', 'socrates', 'athena_SFD']);
const index = Number(process.env.BUFFALO_CASE_INDEX ?? '0');
const approval = process.env.BUFFALO_PAID_RUN === 'I_ACCEPT_CLOUDFLARE_AI_COSTS';

if (!approval) {
  fail('Paid run disabled. Set BUFFALO_PAID_RUN=I_ACCEPT_CLOUDFLARE_AI_COSTS to explicitly enable the Cloudflare agent run.');
} else if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  fail('Cloudflare Workers AI needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
} else if (!supportedAgents.has(agentName)) {
  fail('Unrecognized SFD agent: ' + agentName);
} else if (!Number.isInteger(index) || index < 0) {
  fail('BUFFALO_CASE_INDEX must be a nonnegative integer.');
} else {
  // One case, not an entire benchmark group. Sibling criteria share the same
  // original scenario, prompt and initial model; grade ONE generation three ways.
  const tests = groups.policyImplementation || [];
  const cases = [...new Set(tests.map(t => t.expectations.scenario))];
  const caseId = cases[index];
  if (!caseId) {
    fail('Index out of bounds; available dev cases: ' + cases.length);
  } else {
    const siblings = tests.filter(t => t.expectations.scenario === caseId);
    const baseline = siblings[0];
    const parameters = {
      ...baseline.additionalParameters,
      agentName,
      provider,
      mode: 'sfd',
      intelligence: 'standard'
    };

    console.log('Original Buffalo agent: ' + agentName);
    console.log('Agent provider: ' + provider + ' (Cloudflare Workers AI via original OpenAI-compatible agent loop)');
    console.log('Tool transport: original Buffalo OpenRouter SDK -> IGC validated Workers AI REST JSON adapter');
    console.log('Actual Workers AI model: ' + globalThis.__buffaloCloudflare.model);
    console.log('Evaluation source: evals/categories/policyImplementation.js');
    console.log('Single scenario ID: ' + caseId);
    console.log('Criteria: ' + siblings.map(t => t.expectations.criterion).join(', '));
    console.log('No custom prompt, no modified engine, no Stella client.');
    console.log('Maximum Cloudflare POST budget: ' + globalThis.__buffaloCloudflare.maxPosts);
    console.log('Local preflight neuron allowance: ' + globalThis.__buffaloCloudflare.maxNeurons
      + ' (estimate, not a guaranteed billing cap)');
    const begin = Date.now();
    const record = {
      performedAt: new Date().toISOString(),
      agentName, provider, scenarioId: caseId,
      benchmarkGroup: 'policyImplementation',
      generationEngine: 'agent/utilities/AgentEvalRunner.js',
      note: 'Original Buffalo benchmark. PySD eval harness instead of Stella. Cloudflare original agent and original engine SDK via IGC transport.',
      commit: null,
      elapsedMs: null,
      toolLog: [],
      evidence: {},
      grades: [],
      errors: []
    };

    try {
      record.commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch { record.commit = 'unknown'; }

    // Eval-only observation, no changes to the original AgentEvalRunner.
    // The upstream runner only returns its full toolLog after successful completion.
    // Keep name-only evidence of tool completions even when the agent stops early.
    const observedToolCompletions = [];
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      const match = String(args[0] ?? '').match(/^cloudflare Manual: tool call completed: ([a-zA-Z0-9_]+)/);
      if (match) observedToolCompletions.push(match[1]);
      originalConsoleLog(...args);
    };

    try {
      const run = await runAgent(
        baseline.prompt,
        structuredClone(baseline.currentModel),
        parameters
      );
      record.elapsedMs = Date.now() - begin;
      record.toolLog = run.toolLog || [];
      record.explanation = run.explanation || '';
      record.finalModel = run.lastModel ?? null;
      record.evidence = {
        modelPresent: Array.isArray(run.lastModel?.variables) && run.lastModel.variables.length > 0,
        toolCalls: record.toolLog.length,
        toolNames: record.toolLog.map(x => x.toolName),
        runModelCalls: record.toolLog.filter(x => String(x.toolName).split('__').at(-1) === 'run_model').length,
        timeSeriesCalls: record.toolLog.filter(x => String(x.toolName).split('__').at(-1) === 'get_variable_data').length,
        feedbackCalls: record.toolLog.filter(x => String(x.toolName).split('__').at(-1) === 'get_feedback_information').length,
        toolFailures: record.toolLog.filter(x => x.isError === true).length
      };
      const response = { model: run.lastModel, toolLog: record.toolLog, supportingInfo: { explanation: run.explanation } };
      for (const test of siblings) {
        try {
          const failures = await evaluate(response, test.expectations);
          record.grades.push({
            criterion: test.expectations.criterion,
            passed: failures.length === 0,
            failures
          });
        } catch (e) {
          record.grades.push({ criterion: test.expectations.criterion, passed: false, gradingError: String(e) });
        }
      }
    } catch (e) {
      record.elapsedMs = Date.now() - begin;
      record.errors.push(String(e?.stack || e));
      process.exitCode = 2;
    } finally {
      console.log = originalConsoleLog;
    }

    record.providerReceipts = globalThis.__buffaloCloudflare.serialize();
    record.providerDiagnostics = globalThis.__buffaloCloudflare.diagnostics();
    record.experimentParameters = {
      model: globalThis.__buffaloCloudflare.model,
      agent: agentName,
      caseIndex: index,
      maxPosts: globalThis.__buffaloCloudflare.maxPosts,
      maxNeurons: globalThis.__buffaloCloudflare.maxNeurons,
      agentOutputCap: 4096,
      note: 'Same original benchmark and tools; per-run neuron admission is model-priced and approximate'
    };
    record.observedToolCompletions = observedToolCompletions;
    record.evidence = {
      ...record.evidence,
      observedToolCompletions: observedToolCompletions.length,
      observedToolNames: observedToolCompletions,
      // These are model function-call requests, not necessarily successful tool executions.
      modelRequestedToolCalls: record.providerReceipts.reduce(
        (sum, r) => sum + (r.tool_calls_count || 0), 0
      ),
      cloudflareHttp200Responses: record.providerReceipts.filter(
        r => r.http_status === 200
      ).length
    };
    record.usageFromCloudflare = {
      promptTokens: record.providerReceipts.reduce((sum, r) => sum + (r.usage?.prompt_tokens || 0), 0),
      completionTokens: record.providerReceipts.reduce((sum, r) => sum + (r.usage?.completion_tokens || 0), 0),
      cachedPromptTokens: record.providerReceipts.reduce(
        (sum, r) => sum + (r.usage?.prompt_tokens_details?.cached_tokens || 0), 0
      ),
      neurons: record.providerReceipts.reduce((sum, r) => sum + (r.usage?.neurons || 0), 0),
      money: null,
      note: 'Cloudflare response usage only; Buffalo OpenAI-fallback dollar logs are not valid Cloudflare prices.'
    };
    if (record.providerDiagnostics.exhausted) {
      record.stopReason = 'CLOUDFLARE_POST_BUDGET_EXHAUSTED';
      record.status = 'budget_exhausted';
    } else if (record.providerDiagnostics.neuronPreflightBlockedAttempts > 0) {
      record.stopReason = 'CLOUDFLARE_ESTIMATED_NEURON_PREFLIGHT_LIMIT';
      record.status = 'neuron_preflight_blocked';
    } else if (record.providerDiagnostics.neuronBudget?.unmetered) {
      record.stopReason = 'CLOUDFLARE_USAGE_UNAVAILABLE_FAIL_CLOSED';
      record.status = 'unmetered_fail_closed';
    } else if (record.errors.length) {
      record.stopReason = 'AGENT_EXECUTION_ERROR';
      record.status = 'execution_error';
    } else {
      record.stopReason = 'AGENT_COMPLETED';
      record.status = 'completed';
    }
    record.gradingStatus = record.grades.length === 0 ? 'not_executed' : 'executed';
    record.actualProviderModel = globalThis.__buffaloCloudflare.model;
    record.providerPostCount = record.providerReceipts.length;
    const directory = resolve('benchmark-runs');
    await mkdir(directory, { recursive: true });
    const file = resolve(directory, 'buffalo-agent-' + agentName + '-case-' + index + '-' + Date.now() + '.json');
    await writeFile(file, JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify({
      scenarioId: record.scenarioId,
      agent: record.agentName,
      provider: record.provider,
      evidence: record.evidence,
      stopReason: record.stopReason,
      gradingStatus: record.gradingStatus,
      providerDiagnostics: record.providerDiagnostics,
      usageFromCloudflare: record.usageFromCloudflare,
      experimentParameters: record.experimentParameters,
      grades: record.grades,
      errors: record.errors,
      recordFile: file
    }, null, 2));
    console.log('RESULTS ARE LOCAL AND IGNORABLE; inspect JSON before publishing.');
    console.log('Cloudflare POST count: ' + record.providerPostCount);
    if (record.errors.length) console.error('Agent execution failed; do not count as a benchmark success.');
  }
}
