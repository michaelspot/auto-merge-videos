const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const { safeOutputName } = require('../src/utils.ts');

function setup(download) {
  const calls = [];
  const files = [];
  class File {
    constructor(directory, name) {
      this.uri = `${directory}/${name}`;
      this.exists = false;
      this.size = 0;
      files.push(this);
    }
    delete() { this.exists = false; }
    static async downloadFileAsync(url, destination) {
      calls.push(url);
      return download(destination);
    }
  }
  const source = fs.readFileSync(require.resolve('../src/scrapTransfer.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name === 'expo-file-system') return { File, Paths: { cache: 'file:///cache' } };
    if (name === 'expo-crypto') return { randomUUID: () => 'unique-transfer' };
    if (name === './utils') return { safeOutputName };
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports);
  return { transfer: exports.downloadScrapForHiggsfield, calls, files };
}

const completed = { id: 'job-123', status: 'completed', removeText: true,
  url: 'https://scaylit.example/scrap/results/cleaned.mp4', name: 'Vidéo nettoyée.mp4',
  expiresAt: Date.now() / 1000 + 3600 };

test('Scrap transfers its completed output into a local video that Higgsfield can upload', async () => {
  const { transfer, calls, files } = setup(file => {
    file.exists = true; file.size = 2048; return file;
  });
  const video = await transfer(completed);
  assert.deepEqual(calls, [completed.url]);
  assert.equal(video.uri, files[0].uri);
  assert.equal(video.mimeType, 'video/mp4');
  assert.equal(video.name, 'Video-nettoyee.mp4');
  assert.equal(files[0].exists, true, 'the source must survive until Higgsfield uploads it');
});

test('unfinished and expired Scrap results cannot become Higgsfield sources', async () => {
  const { transfer, calls } = setup(() => { throw new Error('must not download'); });
  await assert.rejects(transfer({ ...completed, status: 'cleaning' }), /prête/);
  await assert.rejects(transfer({ ...completed, expiresAt: 1 }), /expiré/);
  assert.equal(calls.length, 0);
});

test('failed and empty downloads never yield a replacement source and remove partial files', async () => {
  const failed = setup(file => { file.exists = true; throw new Error('network lost'); });
  await assert.rejects(failed.transfer(completed), /network lost/);
  assert.equal(failed.files[0].exists, false);
  const empty = setup(file => { file.exists = true; return file; });
  await assert.rejects(empty.transfer(completed), /vide/);
  assert.equal(empty.files[0].exists, false);
});
