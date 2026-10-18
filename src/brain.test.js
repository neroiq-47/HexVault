import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBrain } from './agents.js';

const broke = { messages: { create: async () => { throw new Error('credit balance is too low'); } } };
const okFetch = (reply, calls = []) => async (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.authorization });
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }) };
};

test('no keys means no brain', () => {
  assert.equal(makeBrain({ backups: [{ name: 'groq', key: '' }] }), null);
});

test('falls back to the free backup when Claude fails', async () => {
  const calls = [];
  const brain = makeBrain({ client: broke, model: 'm', backups: [{ name: 'gemini', key: 'g' }], fetchFn: okFetch({ candidates: [] }, calls) });
  assert.deepEqual(brain.providers, ['claude', 'gemini']);
  const out = await brain('hi');
  assert.equal(out.via, 'gemini');
  assert.equal(calls[0].auth, 'Bearer g');
  assert.equal(calls[0].body.model, 'gemini-2.5-flash');
});

test('a failed provider sits out, then gets retried after the cooldown', async () => {
  let t = 0, claudeCalls = 0;
  const flaky = { messages: { create: async () => { claudeCalls++; throw new Error('down'); } } };
  const brain = makeBrain({ client: flaky, model: 'm', backups: [{ name: 'groq', key: 'k' }], fetchFn: okFetch({ x: 1 }), cooldownMs: 1000, now: () => t });
  await brain('a'); await brain('b');
  assert.equal(claudeCalls, 1);
  t = 2000; await brain('c');
  assert.equal(claudeCalls, 2);
});

test('when every provider fails the error names each one', async () => {
  const bad = async () => ({ ok: false, status: 429 });
  const brain = makeBrain({ client: broke, model: 'm', backups: [{ name: 'groq', key: 'k' }], fetchFn: bad });
  await assert.rejects(brain('x'), /claude: credit.*groq: groq HTTP 429/);
});

test('Groq defaults to gpt-oss with low reasoning effort', async () => {
  const calls = [];
  const brain = makeBrain({ backups: [{ name: 'groq', key: 'k' }], fetchFn: okFetch({ ok: 1 }, calls) });
  await brain('x');
  assert.equal(calls[0].body.model, 'openai/gpt-oss-120b');
  assert.equal(calls[0].body.reasoning_effort, 'low');
});
