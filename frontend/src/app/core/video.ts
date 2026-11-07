import { PreparedImage, scaled } from './image';

/** A video can be this long. */
export const MAX_VIDEO_SECONDS = 60;
/** The backend takes at most 100 MB for a video. */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** What a video is made into: at most 1280 pixels on the long side, about 1.2 Mbit/s (a 1 minute video is about 9 MB, the server accepts up to 30 MB). */
const VIDEO_SIDE = 1280;
const VIDEO_BPS = 1_200_000;
const AUDIO_BPS = 96_000;

/** The formats the server keeps as they are (a file of another format is always made into a new one). */
const KEPT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

/**
 * The best format this browser can record, MP4 with H.264 and AAC where it can (it plays everywhere, with sound), WebM otherwise;
 * null = it cannot record. A bare `video/mp4` is not tried: a browser may then put Opus sound in the MP4, which many players play silently.
 */
export function recorderType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export const recorderOptions = (type: string): MediaRecorderOptions => ({ mimeType: type, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS });

const extensionOf = (type: string) => (type.startsWith('video/mp4') ? 'mp4' : 'webm');

/** A video ready to send: the file (small), its preview picture, and what the message tells about it. */
export interface PreparedVideo extends PreparedImage {
  durationMs: number;
  /** true = the video was longer than the limit: only its first part is sent */
  trimmed: boolean;
}

/** A video file opened for reading its first picture and its length; `done` frees it. */
async function open(source: Blob): Promise<{ video: HTMLVideoElement; done: () => void }> {
  const url = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('This video cannot be opened. Try another one.'));
  });
  return { video, done: () => URL.revokeObjectURL(url) };
}

async function seek(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= 2) return;
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
    video.currentTime = time;
  });
}

/** The preview picture: the first moment of the video. */
async function previewOf(video: HTMLVideoElement): Promise<Blob> {
  await seek(video, Math.min(0.1, (Number.isFinite(video.duration) ? video.duration : 1) / 2));
  return (await scaled(video, 320, 0.8)).blob;
}

/**
 * Makes a video ready to send, in the browser: a chosen or filmed video is played into a recorder at 1280 pixels and about
 * 1.2 Mbit/s (so it takes as long as the video itself, at most 2 minutes, keep the page open), and a longer video is cut
 * after 2 minutes. If that makes it bigger (or the browser cannot record) the original is sent when the server can keep it.
 */
export async function prepareVideo(file: File, onProgress: (fraction: number) => void): Promise<PreparedVideo> {
  const { video, done } = await open(file);
  try {
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('This video cannot be opened. Try another one.');
    const seconds = Math.min(video.duration, MAX_VIDEO_SECONDS);
    const trimmed = video.duration > MAX_VIDEO_SECONDS + 0.5;
    const thumb = await previewOf(video);
    const keepable = KEPT_TYPES.includes(file.type) && file.size <= MAX_VIDEO_BYTES && !trimmed;

    let made: { blob: Blob; width: number; height: number; silent: boolean } | null = null;
    try {
      made = await transcode(video, seconds, onProgress);
    } catch (err) {
      console.warn('The video could not be made smaller', err);
    }
    // a copy without any sound is only sent when the original cannot be sent (the sound matters more than the size)
    if (made && !(keepable && (made.blob.size >= file.size || made.silent))) {
      return { blob: made.blob, thumb, width: made.width, height: made.height, durationMs: Math.round(seconds * 1000), trimmed, name: `${baseName(file.name)}.${extensionOf(made.blob.type)}` };
    }
    if (!keepable) throw new Error(trimmed ? `Videos can be at most ${MAX_VIDEO_SECONDS} seconds.` : 'This video cannot be prepared. Try another one.');
    return { blob: file, thumb, width: video.videoWidth, height: video.videoHeight, durationMs: Math.round(seconds * 1000), trimmed, name: file.name };
  } finally {
    done();
  }
}

/** A video filmed on this page is already small: only its preview picture is made. */
export async function prepareRecorded(blob: Blob, durationMs: number): Promise<PreparedVideo> {
  const { video, done } = await open(blob);
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return { blob, thumb: await previewOf(video), width: video.videoWidth, height: video.videoHeight, durationMs, trimmed: false, name: `video-${stamp}.${extensionOf(blob.type)}` };
  } finally {
    done();
  }
}

/** Plays the video (its first `seconds`) into a recorder: the pictures through a canvas, the sound through the audio system of the browser. */
async function transcode(video: HTMLVideoElement, seconds: number, onProgress: (fraction: number) => void): Promise<{ blob: Blob; width: number; height: number; silent: boolean }> {
  const type = recorderType();
  if (!type || typeof HTMLCanvasElement.prototype.captureStream !== 'function' || typeof AudioContext === 'undefined') throw new Error('This browser cannot record video');
  const k = Math.min(1, VIDEO_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2); // video sizes are even numbers
  const canvas = document.createElement('canvas');
  canvas.width = even(video.videoWidth * k);
  canvas.height = even(video.videoHeight * k);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');

  const stream = canvas.captureStream(30);
  const audio = new AudioContext();
  const sink = audio.createMediaStreamDestination();
  const source = audio.createMediaElementSource(video);
  source.connect(sink); // the sound goes into the recording, not out of the speakers
  const meter = audio.createAnalyser(); // listens along: was there any sound at all?
  source.connect(meter);
  const level = new Uint8Array(meter.fftSize);
  let heard = false;
  sink.stream.getAudioTracks().forEach((track) => stream.addTrack(track));

  const recorder = new MediaRecorder(stream, recorderOptions(type));
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  try {
    await seek(video, 0);
    recorder.start(500);
    await audio.resume();
    await video.play();
    await new Promise<void>((resolve) => {
      const frame = () => {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (!heard) {
          meter.getByteTimeDomainData(level);
          heard = level.some((v) => Math.abs(v - 128) > 1);
        }
        onProgress(Math.min(1, video.currentTime / seconds));
        if (video.ended || video.currentTime >= seconds) resolve();
        else requestAnimationFrame(frame);
      };
      frame();
    });
    video.pause();
    recorder.stop();
    await stopped;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    void audio.close();
  }
  return { blob: new Blob(chunks, { type }), width: canvas.width, height: canvas.height, silent: !heard };
}

const baseName = (name: string) => name.replace(/\.[^./\\]*$/, '') || 'video';
