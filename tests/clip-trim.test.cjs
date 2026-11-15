const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { clipRange, moveClipBoundary, moveClipSelection, clipCutPreviewTime, clipTime, appendClipTrim } = require('../src/clipTiming.ts');

const near = (actual, expected, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);

test('both handles can shorten and restore the original clip without crossing', () => {
  let range = clipRange(undefined, 10);
  range = moveClipBoundary(range, 'start', 2, 10);
  range = moveClipBoundary(range, 'end', 6, 10);
  assert.deepEqual(range, { start: 2, end: 6 });
  near(moveClipBoundary(range, 'start', 15, 10).start, 5.7);
  near(moveClipBoundary(range, 'end', -1, 10).end, 2.3);
  range = moveClipBoundary(range, 'start', -2, 10);
  range = moveClipBoundary(range, 'end', 15, 10);
  assert.deepEqual(range, { start: 0, end: 10 });
});

test('unknown, short and changed source durations stay within valid bounds', () => {
  assert.deepEqual(clipRange(undefined, 0), { start: 0, end: 0 });
  assert.deepEqual(clipRange(undefined, NaN), { start: 0, end: 0 });
  assert.deepEqual(clipRange({ start: 2, end: 10 }, 0.12), { start: 0, end: 0.12 });
  const range = clipRange({ start: 9, end: 15 }, 4);
  near(range.start, 3.7);
  near(range.end, 4);
  assert.deepEqual(moveClipBoundary({ start: 0, end: 0.12 }, 'end', 0, 0.12), { start: 0, end: 0.12 });
  assert.equal(clipTime(59.99), '1:00,0');
});

test('dragging the selection moves both boundaries and keeps its duration at either edge', () => {
  const original = { start: 2, end: 6 };
  assert.deepEqual(moveClipSelection(original, 1.25, 10), { start: 3.25, end: 7.25 });
  assert.deepEqual(moveClipSelection(original, -20, 10), { start: 0, end: 4 });
  assert.deepEqual(moveClipSelection(original, 20, 10), { start: 6, end: 10 });
  assert.deepEqual(moveClipSelection({ start: 0, end: 10 }, 3, 10), { start: 0, end: 10 });
  for (const offset of [-100, -2.42, -0.11, 0, 0.01, 3.98, 100]) {
    const range = moveClipSelection({ start: 1.23, end: 5.678 }, offset, 12.345);
    near(range.end - range.start, 4.448);
    assert.ok(range.start >= 0 && range.end <= 12.345);
  }
});

test('reversing a selection drag uses the original bounds without accumulating motion', () => {
  const atGestureStart = { start: 2, end: 6 };
  assert.deepEqual(moveClipSelection(atGestureStart, 10, 10), { start: 6, end: 10 });
  assert.deepEqual(moveClipSelection(atGestureStart, 2, 10), { start: 4, end: 8 });
  assert.deepEqual(moveClipSelection(atGestureStart, 0, 10), atGestureStart);
  near(moveClipBoundary({ start: 0, end: 5 }, 'end', 5.004, 5.004).end, 5.004);
});

test('cut previews show the opening frame on the left and the last retained frame on the right', () => {
  const range = { start: 1.2, end: 3 };
  near(clipCutPreviewTime(range, 'start', 30), 1.2);
  near(clipCutPreviewTime(range, 'selection', 30), 1.2);
  near(clipCutPreviewTime(range, 'end', 30), 3 - 1 / 30);
  near(clipCutPreviewTime(range, 'end', 60), 3 - 1 / 60);
  near(clipCutPreviewTime({ start: 1, end: 2.05 }, 'end', 30), 61 / 30);
  near(clipCutPreviewTime({ start: 0, end: 0.01 }, 'end', 30), 0);
  near(clipCutPreviewTime(range, 'end', NaN), 3 - 1 / 30);
  assert.ok(clipCutPreviewTime(range, 'end', 24) < range.end);
});

test('hook and capture selections reach the renderer with decimal precision', async () => {
  const { parseClipTrim } = await import('../cloudflare/container/clip-trim.mjs');
  const query = new URLSearchParams();
  const hook = { start: 1.23, end: 4.56 };
  const capture = { start: 9.87, end: 23.45 };
  appendClipTrim(query, 'hook', hook);
  appendClipTrim(query, 'capture', capture);
  assert.deepEqual(parseClipTrim(query, 'hook'), hook);
  assert.deepEqual(parseClipTrim(query, 'capture'), capture);
  assert.equal(parseClipTrim(new URLSearchParams(), 'hook'), null);
});

test('invalid and out-of-source selections are rejected before rendering', async () => {
  const { parseClipTrim, validateClipTrim } = await import('../cloudflare/container/clip-trim.mjs');
  for (const value of ['hookStart=1', 'hookEnd=2', 'hookStart=&hookEnd=2', 'hookStart=-1&hookEnd=2', 'hookStart=2&hookEnd=2', 'hookStart=3&hookEnd=2', 'hookStart=NaN&hookEnd=5', 'hookStart=0&hookEnd=Infinity']) {
    assert.throws(() => parseClipTrim(new URLSearchParams(value), 'hook'));
  }
  const metadata = { streams: [{ codec_type: 'video', duration: '5' }] };
  assert.throws(() => validateClipTrim({ start: 5, end: 6 }, metadata));
  assert.throws(() => validateClipTrim({ start: 0, end: 6 }, metadata));
  assert.throws(() => validateClipTrim({ start: 0, end: 2 }, {}));
  assert.deepEqual(validateClipTrim({ start: 1, end: 5.05 }, metadata), { start: 1, end: 5 });
});

test('FFmpeg exports the chosen frames and exact combined duration, then restores full sources', async () => {
  const { mergeArgs } = await import('../cloudflare/container/clip-trim.mjs');
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const ffprobe = process.env.FFPROBE_PATH || require('ffprobe-static').path;
  const directory = mkdtempSync(path.join(tmpdir(), 'scaylit-clip-test-'));
  const run = (args) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args], { timeout: 60000 });
  const probeDuration = (file) => Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' }));
  const pixel = (file, time) => run(['-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'crop=2:2:540:960,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
  try {
    const hook = path.join(directory, 'hook.mp4');
    const capture = path.join(directory, 'capture.mp4');
    run(['-f', 'lavfi', '-i', "color=red:s=320x180:r=30:d=3,drawbox=color=lime:t=fill:enable='between(t,1,2)'", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', hook]);
    run(['-f', 'lavfi', '-i', "color=blue:s=180x320:r=30:d=3,drawbox=color=yellow:t=fill:enable='gte(t,1)'", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', capture]);
    for (const trimmed of [true, false]) {
      const output = path.join(directory, `${trimmed}.mp4`);
      execFileSync(ffmpeg, mergeArgs({
        hook,
        capture,
        hookTrim: trimmed ? { start: 1.2, end: 1.8 } : null,
        captureTrim: trimmed ? { start: 1.2, end: 2.2 } : null,
        output,
      }), { timeout: 60000 });
      near(probeDuration(output), trimmed ? 1.6 : 6, 1 / 30 + 0.001);
      const first = pixel(output, 0.1);
      const second = pixel(output, trimmed ? 0.7 : 3.1);
      if (trimmed) {
        assert.ok(first[1] > 200 && first[0] < 35 && first[2] < 35, `Expected green hook, received ${first}`);
        assert.ok(second[0] > 200 && second[1] > 200 && second[2] < 35, `Expected yellow capture, received ${second}`);
      } else {
        assert.ok(first[0] > 200 && first[1] < 35, 'Full hook starts with red');
        assert.ok(second[2] > 200 && second[0] < 35, 'Full capture starts with blue');
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('iPhone-like screen recordings (VFR 60 fps, 1206x2622, no audio, non-square pixels) render with music and text', async () => {
  const { mergeArgs, posterArgs } = await import('../cloudflare/container/clip-trim.mjs');
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const ffprobe = process.env.FFPROBE_PATH || require('ffprobe-static').path;
  const directory = mkdtempSync(path.join(tmpdir(), 'scaylit-ios-test-'));
  const run = (args) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args], { timeout: 60000 });
  const streams = (file) => execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const box = (file, time) => {
    return spawnSync(ffmpeg, ['-ss', String(time), '-i', file, '-frames:v', '3', '-vf', 'cropdetect=limit=16:round=2', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  };
  try {
    const hook = path.join(directory, 'hook.mov');
    const capture = path.join(directory, 'capture.mov');
    const squeezed = path.join(directory, 'squeezed.mp4');
    const music = path.join(directory, 'music.m4a');
    const overlay = path.join(directory, 'overlay.png');
    run(['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', hook]);
    run(['-f', 'lavfi', '-i', 'testsrc2=s=1206x2622:r=60:d=3', '-vf', "select='not(between(t,1,2)*mod(n,4))'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', capture]);
    run(['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=2', '-vf', 'setsar=4/3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', squeezed]);
    run(['-f', 'lavfi', '-i', 'sine=f=220:d=1', '-c:a', 'aac', music]);
    run(['-f', 'lavfi', '-i', 'color=black@0:s=1080x1920,format=rgba', '-frames:v', '1', overlay]);

    const output = path.join(directory, 'bulk.mp4');
    execFileSync(ffmpeg, mergeArgs({ hook, capture, captureTrim: { start: 0.5, end: 2.5 }, music, overlay, output }), { timeout: 60000 });
    const result = JSON.parse(streams(output));
    const video = result.streams.find(stream => stream.codec_type === 'video');
    assert.equal(video.width, 1080);
    assert.equal(video.height, 1920);
    assert.ok(result.streams.some(stream => stream.codec_type === 'audio'), 'Music is mixed in');
    near(Number(result.format.duration), 4, 0.1);

    const fitted = path.join(directory, 'fitted.mp4');
    execFileSync(ffmpeg, mergeArgs({ hook, capture: squeezed, output: fitted }), { timeout: 60000 });
    assert.match(box(fitted, 3), /w:1080 h:1440 x:0 y:240/, '4:3 pixels are displayed at their real 3:4 shape');

    const poster = path.join(directory, 'poster.jpg');
    execFileSync(ffmpeg, posterArgs(capture, poster), { timeout: 60000 });
    const posterStream = JSON.parse(streams(poster)).streams[0];
    assert.equal(posterStream.width, 320);
    assert.equal(posterStream.height % 2, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
