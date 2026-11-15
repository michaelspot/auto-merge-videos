const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { buildSync } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

test('Scrap reaches its provider in the Workers runtime and never follows redirects', async () => {
  const id = 'test-job-0123456789abcdef0123456789';
  const script = buildSync({
    stdin: {
      contents: "import { handleScrap } from './cloudflare/scrap'; export default { fetch: (request, env) => handleScrap(request, env) };",
      resolveDir: path.resolve(__dirname, '..'),
    },
    bundle: true, format: 'esm', write: false,
  }).outputFiles[0].text;
  let redirect = false;
  let calls = 0;
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script, compatibilityDate: '2026-08-28',
    bindings: { SCRAP_SERVICE_URL: 'https://scrap.modal.run', SCRAP_SERVICE_TOKEN: 'test-secret' },
    outboundService: async request => {
      calls++;
      assert.equal(request.url, `https://scrap.modal.run/jobs/${id}`);
      assert.equal(request.headers.get('Authorization'), 'Bearer test-secret');
      if (redirect) return new Response(null, { status: 302, headers: { Location: 'https://other.example' } });
      return Response.json({ error: 'Traitement introuvable.' }, { status: 404 });
    },
  }));
  try {
    const response = await runtime.dispatchFetch(`https://scaylit.example/api/scrap?id=${id}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Traitement introuvable.' });
    assert.equal(calls, 1);
    redirect = true;
    const redirected = await runtime.dispatchFetch(`https://scaylit.example/api/scrap?id=${id}`);
    assert.equal(redirected.status, 502);
    assert.equal(calls, 2);
  } finally {
    await runtime.dispose();
  }
});
