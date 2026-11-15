import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';

import TIKTOK_BASE64 from './font-tiktok.js';
import { mergeArgs, parseClipTrim, posterArgs, UserError, validateClipTrim, videoStream } from './clip-trim.mjs';

GlobalFonts.register(Buffer.from(TIKTOK_BASE64, 'base64'), 'TikTokSans');

const PORT = 8080;
const MAX_TEXT_LENGTH = 500;
const HOOK_PREFIXES = ['hooks/', 'hooks-face-reaction/', 'hooks-shocked-face/', 'hooks-surprised-face/'];
// Stops FFmpeg before the app gives up (5 min) so the user gets a readable error.
const FFMPEG_TIMEOUT_MS = 270_000;
const posterJobs = new Map();

function sendJson(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
  });
  response.end(payload);
}

function safeKey(value, prefixes) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && !value.includes('..')
    && !/[\u0000-\u001f\u007f]/.test(value)
    && prefixes.some(prefix => value.startsWith(prefix));
}

function internalR2Url(key) {
  return `http://scaylit.r2/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function downloadKey(key, destination, label = 'Le fichier') {
  const response = await fetch(internalR2Url(key));
  if (response.status === 404) throw new UserError(`${label} est introuvable. Il a peut-être été supprimé.`);
  if (!response.ok || !response.body) {
    throw new Error(`${label} n’a pas pu être téléchargé depuis le stockage (${response.status}).`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function uploadKey(key, source, contentType) {
  const body = await readFile(source);
  const response = await fetch(internalR2Url(key), {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
    },
    body,
  });
  if (!response.ok) throw new Error(`Enregistrement R2 impossible (${response.status}).`);
}

async function run(command, args, failure = 'Le traitement vidéo a échoué.') {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, FFMPEG_TIMEOUT_MS);
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      // The full FFmpeg log stays in the container logs; the app only gets a readable message.
      console.error(`[${command}] échec (${code})`, stderr.trim());
      reject(new Error(timedOut
        ? 'Le traitement a pris trop de temps. Raccourcis la sélection ou utilise une vidéo plus légère.'
        : failure));
    });
  });
}

async function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', file]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`Analyse vidéo impossible. ${stderr.trim().slice(-300)}`));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Analyse vidéo invalide.'));
      }
    });
  });
}

// Checks the file is readable and has the stream we need before running the heavy FFmpeg command.
async function probeInput(file, label, kind = 'video') {
  let metadata;
  try {
    metadata = await probe(file);
  } catch (error) {
    console.error('[probe]', label, error);
    throw new UserError(`${label} n’est pas un fichier ${kind === 'audio' ? 'audio' : 'vidéo'} lisible.`, 422);
  }
  const usable = kind === 'audio'
    ? metadata.streams?.some(stream => stream.codec_type === 'audio')
    : Boolean(videoStream(metadata));
  if (!usable) {
    throw new UserError(kind === 'audio'
      ? `${label} ne contient pas de piste audio.`
      : `${label} ne contient pas d’image vidéo (fichier audio ou format non pris en charge).`, 422);
  }
  return metadata;
}

function rotation(stream) {
  const sideRotation = stream.side_data_list?.find(data => data.rotation !== undefined)?.rotation;
  return Number(sideRotation ?? stream.tags?.rotate ?? 0) % 360;
}

function matchingVideoStreams(first, second) {
  const a = videoStream(first);
  const b = videoStream(second);
  if (!a || !b || rotation(a) !== 0 || rotation(b) !== 0) return false;
  const properties = [
    'profile', 'level', 'pix_fmt', 'r_frame_rate', 'avg_frame_rate',
    'time_base', 'sample_aspect_ratio', 'field_order',
  ];
  return a.codec_name === 'h264'
    && b.codec_name === 'h264'
    && a.codec_tag_string === 'avc1'
    && b.codec_tag_string === 'avc1'
    && a.pix_fmt === 'yuv420p'
    && b.pix_fmt === 'yuv420p'
    && a.width === 1080
    && a.height === 1920
    && b.width === 1080
    && b.height === 1920
    && properties.every(property => a[property] === b[property]);
}

function stripEmojis(text) {
  return text
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function drawTextSpaced(context, text, x, y, spacing, method) {
  const characters = [...text];
  const totalWidth = context.measureText(text).width + spacing * (characters.length - 1);
  let currentX = x - totalWidth / 2;
  context.textAlign = 'left';
  for (const character of characters) {
    if (method === 'stroke') context.strokeText(character, currentX, y);
    else context.fillText(character, currentX, y);
    currentX += context.measureText(character).width + spacing;
  }
  context.textAlign = 'center';
}

async function createTextOverlay(text, outputPath, positionPercent = 50) {
  const cleanText = stripEmojis(text);
  const canvas = createCanvas(1080, 1920);
  const context = canvas.getContext('2d');
  const safeTop = Math.round(1920 * 0.07);
  const safeBottom = Math.round(1920 * 0.75);
  const narrowStart = Math.round(1920 * 0.45);
  const position = Math.max(0, Math.min(100, Number(positionPercent)));
  const lineHeight = 70;
  const estimatedStart = safeTop + ((safeBottom - safeTop - 3 * lineHeight) * position / 100);
  const narrow = estimatedStart + 3 * lineHeight > narrowStart;
  const maxWidth = narrow ? 799 : 907;
  const centerX = narrow ? 486 : 540;

  context.font = '500 54px TikTokSans';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const lines = [];
  for (const segment of cleanText.replace(/\s{2,}/g, '\n').split('\n').map(value => value.trim()).filter(Boolean)) {
    let currentLine = '';
    for (const word of segment.split(' ')) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (context.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  const displayLines = lines.slice(0, 3);
  const totalHeight = displayLines.length * lineHeight;
  const startY = safeTop + ((safeBottom - safeTop - totalHeight) * position / 100) + lineHeight / 2;

  context.strokeStyle = 'black';
  context.lineWidth = 8;
  context.lineJoin = 'round';
  for (let index = 0; index < displayLines.length; index += 1) {
    drawTextSpaced(context, displayLines[index], centerX, startY + index * lineHeight, -1.5, 'stroke');
  }
  context.fillStyle = 'white';
  for (let index = 0; index < displayLines.length; index += 1) {
    drawTextSpaced(context, displayLines[index], centerX, startY + index * lineHeight, -1.5, 'fill');
  }
  await writeFile(outputPath, canvas.toBuffer('image/png'));
}

async function mergeSingle(params) {
  const hookKey = params.get('hookKey');
  const captureKey = params.get('captureKey');
  const requestedHookTrim = parseClipTrim(params, 'hook');
  const requestedCaptureTrim = parseClipTrim(params, 'capture');
  if (!safeKey(hookKey, HOOK_PREFIXES) || !safeKey(captureKey, ['screenrecordings/'])) {
    throw new UserError('Il manque le hook ou la capture.');
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'scaylit-merge-'));
  const hookPath = path.join(directory, 'hook.mp4');
  const capturePath = path.join(directory, 'capture.mp4');
  const outputPath = path.join(directory, 'output.mp4');
  const concatPath = path.join(directory, 'concat.txt');

  try {
    console.log('[merge] téléchargement des vidéos');
    await Promise.all([downloadKey(hookKey, hookPath, 'Le hook'), downloadKey(captureKey, capturePath, 'La capture')]);
    console.log('[merge] analyse des vidéos');
    const [hookProbe, captureProbe] = await Promise.all([
      probeInput(hookPath, 'Le hook'),
      probeInput(capturePath, 'La capture'),
    ]);
    const hookTrim = validateClipTrim(requestedHookTrim, hookProbe);
    const captureTrim = validateClipTrim(requestedCaptureTrim, captureProbe);
    if (!hookTrim && !captureTrim && matchingVideoStreams(hookProbe, captureProbe)) {
      console.log('[merge] assemblage sans réencodage');
      await writeFile(concatPath, `file '${hookPath}'\nfile '${capturePath}'\n`);
      await run('ffmpeg', [
        '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', concatPath,
        '-map', '0:v:0', '-c:v', 'copy', '-tag:v', 'avc1', '-movflags', '+faststart', '-an', outputPath,
      ], 'L’assemblage des deux vidéos a échoué.');
    } else {
      console.log('[merge] assemblage avec réencodage');
      await run('ffmpeg', mergeArgs({
        hook: hookPath, capture: capturePath, hookTrim, captureTrim, output: outputPath,
      }), 'L’assemblage des deux vidéos a échoué. Vérifie que le hook et la capture se lisent correctement.');
    }
    const key = `montages/final-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.mp4`;
    console.log('[merge] enregistrement du résultat');
    await uploadKey(key, outputPath, 'video/mp4');
    console.log('[merge] terminé', key);
    return { key };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function mergeBulk(params) {
  const hookKey = params.get('hookKey');
  const captureKey = params.get('captureKey');
  const requestedHookTrim = parseClipTrim(params, 'hook');
  const requestedCaptureTrim = parseClipTrim(params, 'capture');
  const musicKey = params.get('musiqueKey');
  const rawText = params.get('texte')?.trim() ?? '';
  const text = rawText.slice(0, MAX_TEXT_LENGTH);
  const textY = Number(params.get('textY') ?? 50);
  if (!safeKey(hookKey, HOOK_PREFIXES) || !safeKey(captureKey, ['screenrecordings/'])) {
    throw new UserError('Il manque le hook ou la capture.');
  }
  if (musicKey && !safeKey(musicKey, ['musics/'])) throw new UserError('Musique invalide.');
  if (rawText && (!text || rawText.length > MAX_TEXT_LENGTH)) throw new UserError('Texte invalide.');
  if (!Number.isFinite(textY) || textY < 0 || textY > 100) throw new UserError('Position du texte invalide.');

  const directory = await mkdtemp(path.join(tmpdir(), 'scaylit-bulk-'));
  const hookPath = path.join(directory, 'hook.mp4');
  const capturePath = path.join(directory, 'capture.mp4');
  const musicPath = musicKey ? path.join(directory, 'music') : null;
  const overlayPath = text ? path.join(directory, 'overlay.png') : null;
  const outputPath = path.join(directory, 'output.mp4');

  try {
    const downloads = [downloadKey(hookKey, hookPath, 'Le hook'), downloadKey(captureKey, capturePath, 'La capture')];
    if (musicKey && musicPath) downloads.push(downloadKey(musicKey, musicPath, 'La musique'));
    if (text && overlayPath) downloads.push(createTextOverlay(text, overlayPath, textY));
    await Promise.all(downloads);

    const [hookProbe, captureProbe] = await Promise.all([
      probeInput(hookPath, 'Le hook'),
      probeInput(capturePath, 'La capture'),
      musicPath ? probeInput(musicPath, 'La musique', 'audio') : null,
    ]);
    await run('ffmpeg', mergeArgs({
      hook: hookPath,
      capture: capturePath,
      hookTrim: validateClipTrim(requestedHookTrim, hookProbe),
      captureTrim: validateClipTrim(requestedCaptureTrim, captureProbe),
      music: musicPath,
      overlay: overlayPath,
      output: outputPath,
    }), 'Le montage a échoué. Vérifie que le hook, la capture et la musique se lisent correctement.');

    const key = `montages/bulk-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.mp4`;
    await uploadKey(key, outputPath, 'video/mp4');
    return { key };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createPoster(key, posterKey) {
  const directory = await mkdtemp(path.join(tmpdir(), 'scaylit-poster-'));
  const inputPath = path.join(directory, 'input');
  const outputPath = path.join(directory, 'poster.jpg');
  try {
    try {
      // FFmpeg reads the source over HTTP with Range requests: only the index and the first
      // frame are transferred, instead of the whole (often several hundred MB) recording.
      await run('ffmpeg', posterArgs(internalR2Url(key), outputPath));
    } catch (streamError) {
      console.warn('[poster] lecture directe impossible, téléchargement complet', streamError);
      await downloadKey(key, inputPath, 'La vidéo');
      await probeInput(inputPath, 'La vidéo');
      await run('ffmpeg', posterArgs(inputPath, outputPath), 'L’aperçu de la vidéo n’a pas pu être généré.');
    }
    await uploadKey(posterKey, outputPath, 'image/jpeg');
    return { posterKey };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function generatePoster(params) {
  const key = params.get('publicId');
  if (!safeKey(key, [...HOOK_PREFIXES, 'screenrecordings/'])) throw new UserError('Fichier vidéo invalide.');
  const [folder, ...rest] = key.split('/');
  const posterKey = `posters/${folder}/${rest.join('/')}.jpg`;
  // Concurrent requests for the same video share a single FFmpeg run.
  let job = posterJobs.get(key);
  if (!job) {
    job = createPoster(key, posterKey).finally(() => posterJobs.delete(key));
    posterJobs.set(key, job);
  }
  return job;
}

createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' || !request.url) return sendJson(response, 405, { error: 'Méthode non autorisée.' });
    const url = new URL(request.url, `http://${request.headers.host ?? 'container'}`);
    let result;
    if (url.pathname === '/merge') result = await mergeSingle(url.searchParams);
    else if (url.pathname === '/bulk-merge') result = await mergeBulk(url.searchParams);
    else if (url.pathname === '/poster') result = await generatePoster(url.searchParams);
    else return sendJson(response, 404, { error: 'Route introuvable.' });
    return sendJson(response, 200, result);
  } catch (error) {
    console.error('Scaylit container error', error);
    return sendJson(response, error instanceof UserError ? error.status : 500, {
      error: error instanceof Error && error.message ? error.message : 'Traitement vidéo impossible.',
    });
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Scaylit FFmpeg container listening on ${PORT}`);
});
