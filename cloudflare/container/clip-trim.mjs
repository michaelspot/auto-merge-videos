export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function parseClipTrim(params, prefix) {
  const startValue = params.get(`${prefix}Start`);
  const endValue = params.get(`${prefix}End`);
  if (startValue === null && endValue === null) return null;
  const start = Number(startValue);
  const end = Number(endValue);
  if (!startValue?.trim() || !endValue?.trim()
    || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new UserError(`Découpe ${prefix === 'hook' ? 'du hook' : 'de la capture'} invalide.`);
  }
  return { start, end };
}

export function videoStream(metadata) {
  return metadata?.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
}

export function mediaDuration(metadata) {
  const duration = Number(videoStream(metadata)?.duration ?? metadata?.format?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : Number(metadata?.format?.duration);
}

export function validateClipTrim(trim, metadata) {
  if (!trim) return null;
  const duration = mediaDuration(metadata);
  if (!Number.isFinite(duration) || duration <= 0) throw new UserError('Durée vidéo introuvable.');
  // Native players and ffprobe can differ by a few frames at the end of a source.
  if (trim.start >= duration || trim.end > duration + 0.25) {
    throw new UserError('La sélection dépasse la durée de la vidéo. Ajuste les poignées puis réessaie.');
  }
  return { start: trim.start, end: Math.min(trim.end, duration) };
}

const seconds = value => value.toFixed(6);

// Input-side seek: FFmpeg jumps to the nearest keyframe and only decodes the selected range,
// instead of decoding the whole (often long, 60 fps HEVC) screen recording up to the cut.
export function clipInputArgs(file, trim) {
  return trim
    ? ['-ss', seconds(trim.start), '-t', seconds(trim.end - trim.start), '-i', file]
    : ['-i', file];
}

// Normalizes any source (VFR, 60 fps, odd sizes such as 1206x2622, non-square pixels, rotation
// metadata, any timebase) to 1080x1920 / 30 fps CFR / square pixels so both clips can be concatenated.
export function clipVideoFilter(input, output) {
  return `[${input}:v:0]settb=AVTB,setpts=PTS-STARTPTS,fps=30,`
    + 'scale=w=iw*sar:h=ih,setsar=1,'
    + 'scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,'
    + `pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[${output}]`;
}

export function mergeArgs({ hook, capture, hookTrim = null, captureTrim = null, music = null, overlay = null, output }) {
  const args = ['-y', '-v', 'error', ...clipInputArgs(hook, hookTrim), ...clipInputArgs(capture, captureTrim)];
  if (music) args.push('-i', music);
  if (overlay) args.push('-i', overlay);
  const filters = [clipVideoFilter(0, 'v0'), clipVideoFilter(1, 'v1'), '[v0][v1]concat=n=2:v=1:a=0[concatv]'];
  let videoLabel = 'concatv';
  if (overlay) {
    filters.push(`[concatv][${music ? 3 : 2}:v]overlay=0:0[outv]`);
    videoLabel = 'outv';
  }
  args.push(
    '-filter_complex', filters.join(';'), '-map', `[${videoLabel}]`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-r', '30', '-fps_mode', 'cfr', '-tag:v', 'avc1', '-threads', '0', '-max_muxing_queue_size', '1024',
  );
  if (music) args.push('-map', '2:a:0', '-c:a', 'aac', '-b:a', '128k', '-af', 'apad', '-shortest');
  else args.push('-an');
  args.push('-movflags', '+faststart', output);
  return args;
}

export function posterArgs(input, output) {
  const network = /^https?:/.test(input) ? ['-rw_timeout', '20000000'] : [];
  return [
    '-y', '-v', 'error', ...network, '-i', input,
    '-map', '0:v:0', '-frames:v', '1',
    '-vf', 'scale=w=iw*sar:h=ih,setsar=1,scale=320:-2', '-q:v', '4', '-update', '1', output,
  ];
}
