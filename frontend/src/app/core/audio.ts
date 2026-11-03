import { formatBytes } from './image';

/** A voice message can be this long (an audio file too). */
export const MAX_AUDIO_SECONDS = 120;
/** The backend takes at most 25 MB for audio. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** A voice is recorded at 32 kbit/s, mono is enough (2 minutes are about 0.5 MB). */
const AUDIO_BPS = 32_000;

/**
 * The format this browser records: AAC in MP4 (Safari, newer Chrome) or Opus in WebM / Ogg. Only formats with named codecs are
 * tried: a bare `audio/mp4` may not say what is inside. null = it cannot record.
 */
export function audioRecorderType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export const audioRecorderOptions = (type: string): MediaRecorderOptions => ({ mimeType: type, audioBitsPerSecond: AUDIO_BPS });

/** Audio ready to send: the file, its name and its length. */
export interface PreparedAudio {
  blob: Blob;
  name: string;
  durationMs: number;
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const extensionOf = (type: string) => (type.startsWith('audio/mp4') ? 'm4a' : type.startsWith('audio/ogg') ? 'ogg' : 'webm');

/** What was recorded on this page is already small. */
export function prepareRecordedAudio(blob: Blob, durationMs: number): PreparedAudio {
  return { blob, name: `voice-${stamp()}.${extensionOf(blob.type)}`, durationMs };
}

/**
 * A chosen audio file is sent as it is (it is not played again to make it smaller, that would take as long as the audio itself):
 * at most 2 minutes and 25 MB. The server checks what the file really is.
 */
export async function prepareAudioFile(file: File): Promise<PreparedAudio> {
  if (file.size > MAX_AUDIO_BYTES) throw new Error(`That file is too big (${formatBytes(file.size)}). Audio can be at most ${formatBytes(MAX_AUDIO_BYTES)}.`);
  const seconds = await lengthOf(file);
  if (seconds > MAX_AUDIO_SECONDS + 0.5) throw new Error(`That audio is ${Math.round(seconds)} seconds long. Audio can be at most ${MAX_AUDIO_SECONDS / 60} minutes.`);
  return { blob: file, name: file.name, durationMs: Math.round(seconds * 1000) };
}

/** The length in seconds (a recording made by a browser has none in its header: it is found by going to the end). */
async function lengthOf(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio();
  audio.preload = 'metadata';
  try {
    return await new Promise<number>((resolve, reject) => {
      audio.onerror = () => reject(new Error('This audio file cannot be opened. Try another one (MP3, M4A, WAV, OGG or WebM).'));
      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration)) return resolve(audio.duration);
        audio.ontimeupdate = () => {
          audio.ontimeupdate = null;
          resolve(audio.duration);
        };
        audio.currentTime = 1e101;
      };
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
