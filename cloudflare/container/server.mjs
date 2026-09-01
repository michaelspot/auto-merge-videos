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

GlobalFonts.register(Buffer.from(TIKTOK_BASE64, 'base64'), 'TikTokSans');

const PORT = 8080;
const MAX_TEXT_LENGTH = 500;
const HOOK_PREFIXES = ['hooks/', 'hooks-face-reaction/', 'hooks-shocked-face/', 'hooks-surprised-face/'];

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

async function downloadKey(key, destination) {
  const response = await fetch(internalR2Url(key));
  if (!response.ok || !response.body) {
    throw new Error(`Fichier R2 inaccessible (${response.status}).`);
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

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-20_000);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} a échoué (${code}). ${stderr.trim()}`));
    });
  });
}

async function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', file]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`Analyse vidéo impossible. ${stderr.trim()}`));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Analyse vidéo invalide.'));
      }
    });
  });
}

function matchingVideoStreams(first, second) {
  const a = first.streams?.find(stream => stream.codec_type === 'video');
  const b = second.streams?.find(stream => stream.codec_type === 'video');
  if (!a || !b) return false;
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
  if (!safeKey(hookKey, HOOK_PREFIXES) || !safeKey(captureKey, ['screenrecordings/'])) {
    throw new Error('Il manque le hook ou la capture.');
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'scaylit-merge-'));
  const hookPath = path.join(directory, 'hook.mp4');
  const capturePath = path.join(directory, 'capture.mp4');
  const outputPath = path.join(directory, 'output.mp4');
  const concatPath = path.join(directory, 'concat.txt');

  try {
    await Promise.all([downloadKey(hookKey, hookPath), downloadKey(captureKey, capturePath)]);
    const [hookProbe, captureProbe] = await Promise.all([probe(hookPath), probe(capturePath)]);
    if (matchingVideoStreams(hookProbe, captureProbe)) {
      await writeFile(concatPath, `file '${hookPath}'\nfile '${capturePath}'\n`);
      await run('ffmpeg', [
        '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
        '-map', '0:v:0', '-c:v', 'copy', '-tag:v', 'avc1', '-movflags', '+faststart', '-an', outputPath,
      ]);
    } else {
      await run('ffmpeg', [
        '-y', '-i', hookPath, '-i', capturePath,
        '-filter_complex',
        '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v0];[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[outv]',
        '-map', '[outv]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-tag:v', 'avc1', '-threads', '0', '-an', outputPath,
      ]);
    }
    const key = `montages/final-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.mp4`;
    await uploadKey(key, outputPath, 'video/mp4');
    return { key };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function mergeBulk(params) {
  const hookKey = params.get('hookKey');
  const captureKey = params.get('captureKey');
  const musicKey = params.get('musiqueKey');
  const rawText = params.get('texte')?.trim() ?? '';
  const text = rawText.slice(0, MAX_TEXT_LENGTH);
  const textY = Number(params.get('textY') ?? 50);
  if (!safeKey(hookKey, HOOK_PREFIXES) || !safeKey(captureKey, ['screenrecordings/'])) {
    throw new Error('Il manque le hook ou la capture.');
  }
  if (musicKey && !safeKey(musicKey, ['musics/'])) throw new Error('Musique invalide.');
  if (rawText && (!text || rawText.length > MAX_TEXT_LENGTH)) throw new Error('Texte invalide.');
  if (!Number.isFinite(textY) || textY < 0 || textY > 100) throw new Error('Position du texte invalide.');

  const directory = await mkdtemp(path.join(tmpdir(), 'scaylit-bulk-'));
  const hookPath = path.join(directory, 'hook.mp4');
  const capturePath = path.join(directory, 'capture.mp4');
  const musicPath = musicKey ? path.join(directory, 'music') : null;
  const overlayPath = text ? path.join(directory, 'overlay.png') : null;
  const outputPath = path.join(directory, 'output.mp4');

  try {
    const downloads = [downloadKey(hookKey, hookPath), downloadKey(captureKey, capturePath)];
    if (musicKey && musicPath) downloads.push(downloadKey(musicKey, musicPath));
    if (text && overlayPath) await createTextOverlay(text, overlayPath, textY);
    await Promise.all(downloads);

    const args = ['-y', '-i', hookPath, '-i', capturePath];
    if (musicPath) args.push('-i', musicPath);
    if (overlayPath) args.push('-i', overlayPath);
    const filters = [
      '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v0]',
      '[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v1]',
      '[v0][v1]concat=n=2:v=1:a=0[concatv]',
    ];
    let videoLabel = 'concatv';
    if (overlayPath) {
      filters.push(`[concatv][${musicPath ? 3 : 2}:v]overlay=0:0[outv]`);
      videoLabel = 'outv';
    }
    args.push(
      '-filter_complex', filters.join(';'), '-map', `[${videoLabel}]`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-tag:v', 'avc1', '-movflags', '+faststart', '-threads', '0',
    );
    if (musicPath) {
      args.push('-map', '2:a', '-c:a', 'aac', '-b:a', '128k', '-af', 'apad', '-shortest');
    } else {
      args.push('-an');
    }
    args.push(outputPath);
    await run('ffmpeg', args);

    const key = `montages/bulk-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.mp4`;
    await uploadKey(key, outputPath, 'video/mp4');
    return { key };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function generatePoster(params) {
  const key = params.get('publicId');
  if (!safeKey(key, [...HOOK_PREFIXES, 'screenrecordings/'])) throw new Error('Fichier vidéo invalide.');
  const [folder, ...rest] = key.split('/');
  const posterKey = `posters/${folder}/${rest.join('/')}.jpg`;
  const directory = await mkdtemp(path.join(tmpdir(), 'scaylit-poster-'));
  const inputPath = path.join(directory, 'input');
  const outputPath = path.join(directory, 'poster.jpg');
  try {
    await downloadKey(key, inputPath);
    await run('ffmpeg', ['-y', '-ss', '0', '-i', inputPath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '3', outputPath]);
    await uploadKey(posterKey, outputPath, 'image/jpeg');
    return { posterKey };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
    return sendJson(response, 400, {
      error: error instanceof Error ? error.message : 'Traitement vidéo impossible.',
    });
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Scaylit FFmpeg container listening on ${PORT}`);
});
