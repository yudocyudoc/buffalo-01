import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFLINE_KIND, OFFLINE_WORKFLOW, acceptOfflineTask, assertTaskId,
  assertTransition, makeDispatchInputs, canAutoRedispatch, STATES
} from './contract.mjs';

const valid = {
  task_id: '123e4567-e89b-42d3-a456-426614174000',
  kind: OFFLINE_KIND,
  input_sha256: 'a'.repeat(64)
};

test('admit only strictly typed offline work; no accidental paid lane', () => {
  const task = acceptOfflineTask(valid);
  assert.equal(task.state, 'READY');
  assert.equal(task.workflow, OFFLINE_WORKFLOW);
  assert.equal(task.paid, false);
  for (const bad of [
    {...valid, kind: 'MERLIN_PAID_RUN'},
    {...valid, command: 'curl something'},
    {...valid, paid: true},
    {...valid, input_sha256: ''},
    {...valid, task_id: '../bad'},
    null
  ]) assert.throws(() => acceptOfflineTask(bad), /CONTROL_PLANE_/);
});

test('dispatch requires an explicit claimed task and fixed workflow', () => {
  const task = acceptOfflineTask(valid);
  assert.throws(() => makeDispatchInputs(task), /NOT_CLAIMED/);
  const claimed = {...task, state: 'DISPATCHING'};
  assert.deepEqual(makeDispatchInputs(claimed), {ref: 'main', inputs: {task_id: valid.task_id}});
  assert.throws(() => makeDispatchInputs({...claimed, workflow: 'paid-agent-case.yml'}), /NOT_ALLOWED/);
});

test('states distinguish dispatch uncertainty, completion and failed execution', () => {
  for (const [from, to] of [
    ['READY','DISPATCHING'], ['DISPATCHING','SUBMITTED'],
    ['DISPATCHING','DISPATCH_UNKNOWN'], ['SUBMITTED','RUNNING'],
    ['RUNNING','SUCCEEDED'], ['RUNNING','FAILED'],
    ['DISPATCH_UNKNOWN','SUBMITTED']
  ]) assert.deepEqual(assertTransition(from,to),{from,to});
  for (const [from,to] of [
    ['READY','SUCCEEDED'], ['SUCCEEDED','RUNNING'],
    ['FAILED','READY'], ['DISPATCH_UNKNOWN','DISPATCHING'],
    ['READY','READY'], ['UNKNOWN','RUNNING']
  ]) assert.throws(() => assertTransition(from,to), /INVALID_TRANSITION/);
});

test('a network ambiguity must never cause an implicit second GitHub dispatch', () => {
  for (const s of STATES) assert.equal(canAutoRedispatch(s), false);
  assert.throws(() => assertTaskId('not-an-id'));
});
