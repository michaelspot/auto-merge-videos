const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { videoModelsFromCatalog, makeHiggsfieldVideoParams, exactHiggsfieldCost, higgsfieldJobPending } = require('../src/higgsfield.ts');

const filename = path.resolve(__dirname, '../src/higgsfieldMcp.ts');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { HiggsfieldMcpClient, parseMcpEvent, unwrapMcpResult } = compiled.exports;

const seedance = {
  id: 'seedance_2_5', name: 'Seedance 2.5', output_type: 'video',
  medias: [{ roles: ['image_references', 'video_references'] }],
  aspect_ratios: ['auto', '9:16', '16:9'],
  parameters: [
    { name: 'duration', type: 'number', min: 4, max: 30, default: 5 },
    { name: 'mode', type: 'string', options: ['t2v', 'omni_reference', 'video_edit'], default: 't2v' },
    { name: 'resolution', type: 'string', options: ['720p', '1080p'], default: '720p' },
    { name: 'generate_audio', type: 'bool', default: true },
  ],
};

test('only models accepting both photo and video with configurable output duration are offered', () => {
  const imageOnly = { ...seedance, id: 'image-only', medias: [{ roles: ['start_image'] }] };
  const sourceDurationOnly = { ...seedance, id: 'source-length', parameters: [] };
  const models = videoModelsFromCatalog([imageOnly, sourceDurationOnly, seedance]);
  assert.deepEqual(models.map(model => model.id), ['seedance_2_5']);
  assert.deepEqual(models[0].formats, ['9:16', '16:9']);
  assert.equal(models[0].durations[0], 4);
  assert.equal(models[0].durations.at(-1), 30);
});

test('Seedance uses reference generation so format and duration remain effective', () => {
  const model = videoModelsFromCatalog([seedance])[0];
  const params = makeHiggsfieldVideoParams(model, ' Remplacer la personne ', '9:16', 7, 'video-id', 'image-id');
  assert.equal(params.mode, 'omni_reference');
  assert.equal(params.duration, 7);
  assert.equal(params.aspect_ratio, '9:16');
  assert.equal(params.resolution, '1080p');
  assert.equal(params.generate_audio, false);
  assert.equal(params.count, 1);
  assert.equal(params.use_unlim, false);
  assert.deepEqual(params.medias, [{ role: 'video_references', value: 'video-id' }, { role: 'image_references', value: 'image-id' }]);
  assert.throws(() => makeHiggsfieldVideoParams(model, 'x', '1:1', 7, 'v', 'i'));
  assert.throws(() => makeHiggsfieldVideoParams(model, 'x', '9:16', 31, 'v', 'i'));
});

test('Fast mode never inherits the 1080p standard setting', () => {
  const standard = { ...seedance, id: 'seedance_2_0', parameters: seedance.parameters.map(p => p.name === 'mode' ? { ...p, options: ['std', 'fast'], default: 'std' } : p) };
  const fast = videoModelsFromCatalog([standard]).find(model => model.id === 'seedance_2_0_fast');
  assert.equal(fast.sourceId, 'seedance_2_0');
  assert.equal(fast.defaults.resolution, '720p');
  assert.equal(fast.defaults.mode, 'fast');
});

test('exact fractional costs are preserved and silently adjusted or invalid quotes cannot authorize a generation', () => {
  assert.equal(exactHiggsfieldCost({ cost: { credits: 63, credits_exact: 63.25 } }), 63.25);
  for (const reply of [{}, { cost: { credits_exact: -1 } }, { cost: { credits_exact: NaN } },
    { error: 'Insufficient credits' }, { cost: { credits_exact: 63 }, adjustments: { 'params.duration': { used: 5 } } }]) {
    assert.throws(() => exactHiggsfieldCost(reply));
  }
});

test('MCP JSON and SSE responses are parsed without consuming notification messages', () => {
  const events = 'event: message\r\ndata: {"method":"notifications/progress"}\r\n\r\ndata: {"id":8,"result":{"ok":true}}\r\n\r\n';
  assert.deepEqual(parseMcpEvent(events, 8).result, { ok: true });
  assert.equal(parseMcpEvent(events, 9), null);
  assert.deepEqual(unwrapMcpResult({ content: [{ type: 'text', text: '{"credits":63}' }] }), { credits: 63 });
  assert.throws(() => unwrapMcpResult({ isError: true, content: [{ type: 'text', text: 'No credits' }] }), /No credits/);
});

test('concurrent catalog reads share one initialized MCP session and preserve the bearer only for Higgsfield', async () => {
  const calls = [];
  const client = new HiggsfieldMcpClient(async () => 'test-token', async (url, init) => {
    assert.equal(url, 'https://mcp.higgsfield.ai/mcp');
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    const payload = JSON.parse(init.body);
    calls.push(payload.method);
    if (payload.method === 'initialize') return Response.json({ id: payload.id, result: { protocolVersion: '2025-03-26' } }, { headers: { 'Mcp-Session-Id': 'test-session' } });
    assert.equal(init.headers['Mcp-Session-Id'], 'test-session');
    assert.equal(init.headers['MCP-Protocol-Version'], '2025-03-26');
    if (payload.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return new Response(`data: ${JSON.stringify({ id: payload.id, result: { tools: [] } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await Promise.all([client.listTools(), client.listTools()]);
  assert.equal(calls.filter(method => method === 'initialize').length, 1);
  assert.equal(calls.filter(method => method === 'notifications/initialized').length, 1);
});

test('a dropped response to a paid request is never retried automatically', async () => {
  let submissions = 0;
  const client = new HiggsfieldMcpClient(async () => 'test-token', async (_url, init) => {
    const payload = JSON.parse(init.body);
    if (payload.method === 'initialize') return Response.json({ id: payload.id, result: { protocolVersion: '2025-06-18' } });
    if (payload.method === 'notifications/initialized') return new Response(null, { status: 202 });
    assert.equal(payload.params.arguments.params.get_cost, false);
    submissions++;
    throw new Error('connection dropped after submit');
  });
  await assert.rejects(client.call('generate_video', { params: { get_cost: false } }), /connection dropped/);
  assert.equal(submissions, 1);
});

test('rejected and rights-review videos are terminal and never automatically resubmitted', () => {
  for (const status of ['failed', 'canceled', 'nsfw', 'ip_detected', 'completed']) assert.equal(higgsfieldJobPending({ status }), false);
  for (const status of ['queued', 'in_progress', 'ip_detect']) assert.equal(higgsfieldJobPending({ status }), true);
});
