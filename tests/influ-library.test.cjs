const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../cloudflare/worker.ts');
const route = new Module(filename, module);
route.filename = filename;
route.paths = module.paths;
route.require = name => {
  if (name === '@cloudflare/containers') return { Container: class {}, ContainerProxy: class {} };
  if (name === './scrap') return {};
  if (name === 'aws4fetch') return { AwsClient: class { async sign(request) { return request; } } };
  return require(name);
};
route._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const worker = route.exports.default;
const request = (path, init) => new Request(`https://scaylit.example${path}`, init);

test('uploaded Influ photos are listed as images with their own preview, never as montage clips', async () => {
  const photo = { key: 'influs/reference.jpg', size: 123, uploaded: new Date('2026-09-08T12:00:00Z'), customMetadata: { tags: 'Alice' } };
  const env = { MEDIA: { list: async ({ prefix }) => ({ objects: prefix === 'influs/' ? [photo] : [], truncated: false }) } };
  const response = await worker.fetch(request('/api/list'), env);
  assert.equal(response.status, 200);
  const library = await response.json();
  assert.equal(library.influs.length, 1);
  assert.equal(library.influs[0].resource_type, 'image');
  assert.equal(library.influs[0].posterUrl, 'https://scaylit.example/media/influs/reference.jpg');
  assert.deepEqual(library.influs[0].tags, ['Alice']);
  assert.deepEqual(library.hooks, []);
  assert.deepEqual(library.captures, []);
});

test('photo upload signatures preserve the image MIME type, extension and tag', async () => {
  const env = { R2_ENDPOINT: 'https://r2.example', R2_BUCKET_NAME: 'test', MEDIA: { head: async () => null } };
  for (const [contentType, extension] of [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/heic', 'heic']]) {
    const response = await worker.fetch(request('/api/sign-upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: 'influs', public_id: 'alice', contentType, tags: 'Portrait' }),
    }), env);
    assert.equal(response.status, 200);
    const upload = await response.json();
    assert.equal(upload.key, `influs/alice.${extension}`);
    assert.equal(upload.headers['Content-Type'], contentType);
    assert.equal(upload.headers['x-amz-meta-tags'], 'Portrait');
  }
});

test('an empty photo library stays compatible with the existing media collections', async () => {
  const response = await worker.fetch(request('/api/list'), { MEDIA: { list: async () => ({ objects: [], truncated: false }) } });
  assert.deepEqual(await response.json(), { hooks: [], captures: [], musiques: [], influs: [], textes: [] });
});
