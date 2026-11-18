#!/usr/bin/env node
/**
 * Makes the sound of a poke on the iPhone: client-wrappers/ios/App/App/poke.caf, an alarm-clock pattern of two tones, 25 seconds, mono, 16-bit.
 * A Critical Alert plays a file of the app (at most 30 seconds, once: iPhone does not repeat it), so the pattern repeats INSIDE the file. It is written here directly
 * (a CAF file with linear PCM), so it needs no Mac: run `npm run poke:sound` anywhere and commit the file. See docs/design/poke-alarm.md, "iPhone".
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 16000;
const SECONDS = 25; // under the 30 seconds an iPhone plays at most
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'client-wrappers', 'ios', 'App', 'App', 'poke.caf');

// one "ring": two tones of 0.2 s with a short gap, twice, then a pause; the whole ring is 1.2 s
const samples = new Int16Array(RATE * SECONDS);
const tone = (start, length, frequency) => {
  for (let i = 0; i < length * RATE; i++) {
    const t = i / RATE;
    const fade = Math.min(1, t / 0.01, (length - t) / 0.01); // 10 ms in and out: no clicks
    const square = Math.sin(2 * Math.PI * frequency * t) >= 0 ? 1 : -1; // a square wave is harsher and carries over a noisy room
    const at = Math.round((start + t) * RATE);
    if (at < samples.length) samples[at] = Math.round(square * Math.max(0, fade) * 0.55 * 32767);
  }
};
for (let ring = 0; ring * 1.2 < SECONDS - 1; ring++) {
  const start = ring * 1.2;
  tone(start, 0.2, 880);
  tone(start + 0.25, 0.2, 1175);
  tone(start + 0.5, 0.2, 880);
  tone(start + 0.75, 0.2, 1175);
}

// CAF: file header, a 'desc' chunk (linear PCM, 16 bit, little endian), a 'data' chunk (4 bytes edit count, then the samples). All numbers are big endian.
const desc = Buffer.alloc(32);
desc.writeDoubleBE(RATE, 0);
desc.write('lpcm', 8, 'ascii');
desc.writeUInt32BE(2, 12); // kCAFLinearPCMFormatFlagIsLittleEndian
desc.writeUInt32BE(2, 16); // bytes per packet
desc.writeUInt32BE(1, 20); // frames per packet
desc.writeUInt32BE(1, 24); // channels per frame
desc.writeUInt32BE(16, 28); // bits per channel
const pcm = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength); // this machine is little endian, as the flag says
const header = Buffer.alloc(8);
header.write('caff', 0, 'ascii');
header.writeUInt16BE(1, 4); // version
header.writeUInt16BE(0, 6); // flags
const chunk = (type, body) => {
  const head = Buffer.alloc(12);
  head.write(type, 0, 'ascii');
  head.writeBigInt64BE(BigInt(body.length), 4);
  return Buffer.concat([head, body]);
};
const data = Buffer.concat([Buffer.alloc(4), pcm]); // edit count 0
writeFileSync(out, Buffer.concat([header, chunk('desc', desc), chunk('data', data)]));
console.log(`wrote ${out}: ${SECONDS} s, ${Math.round((header.length + 12 + 32 + 12 + data.length) / 1024)} KB`);
