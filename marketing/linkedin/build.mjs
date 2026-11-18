// Makes the LinkedIn images: one HTML per image, then a PNG of it (Microsoft Edge, headless).
// Run from the project root: node marketing/linkedin/build.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
mkdirSync(join(here, 'html'), { recursive: true });

// the alarm bell of the app icon (purple on the logo, white on the red round button)
const BELL = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9'/%3E%3Cpath d='M10.3 21a1.94 1.94 0 003.4 0'/%3E%3C/svg%3E")`;
const BELL_WHITE = BELL.replace('%237c3aed', '%23ffffff');

// the four circles: the words of the app (frontend/src/app/core/active-circle.service.ts and the short welcome pages)
const CIRCLES = {
  friends: { app: 'Seven Friends', head: 'The ones you want<br>shall get through', line: 'One poke, and your friend’s phone rings like an alarm. Even on silent. Even at night.', noise: ['47 new posts', 'Flash sale ends tonight!', 'Someone liked…'], who: 'Mia' },
  buddies: { app: 'Seven Buddies', head: 'Your buddies get through.<br>Nobody else.', line: 'One poke rings your buddy’s phone like an alarm. Seven seats. No feed. No ads.', noise: ['Trending now', 'Sponsored: new shoes', '12 people reacted'], who: 'Jonas' },
  work: { app: 'Seven Work', head: 'The contacts you need<br>get through', line: 'One poke rings their phone, when work cannot wait. Seven seats. No big channels.', noise: ['#general: 142 unread', 'Re: Fwd: Fwd: Q3 report', 'Meeting moved again'], who: 'Lisa' },
  family: { app: 'Seven Family', head: 'Your family<br>always gets through', line: 'Quiet at night. A poke rings the phone if it is urgent. No ads. No feed. Nothing sold.', noise: ['Join our community of 2M', 'Update available', 'Win a free phone!'], who: 'Mom' },
};

const COMMON = `
*{box-sizing:border-box;margin:0}
body{background:linear-gradient(135deg,#fde6c6 0%,#fffbe9 70%);font-family:'Segoe UI',Arial,sans-serif;color:#1f2937}
.logo{border-radius:30%;background:linear-gradient(135deg,#2f4b7c,#4a76c4);color:#fff;font-weight:700;display:grid;place-items:center;position:relative;padding-right:.36em;line-height:1;flex:none}
.logo::after{content:'';position:absolute;left:57.8%;top:53.5%;width:36%;height:36%;border-radius:50%;background:#fff ${BELL} center/62% no-repeat}
h1{font-weight:800;color:#2f4b7c}
.n{padding:8px 20px;border-radius:999px;background:#fff6d8;border:2px solid #e6d9bd;color:#5b6270;text-decoration:line-through}
.ar{color:#5b6270;line-height:1}
.c{display:inline-flex;align-items:center;gap:14px;padding:16px 34px;border-radius:999px;background:#2f4b7c;color:#fff;font-weight:600;white-space:nowrap}
.c i{width:1.25em;height:1.25em;border-radius:50%;background:#ba0c2f ${BELL_WHITE} center/62% no-repeat}
.url{position:absolute;bottom:34px;font-weight:700;color:#2f4b7c;letter-spacing:.01em}
.dots{display:flex;gap:14px}
.dots i{width:20px;height:20px;border-radius:50%;background:#2f4b7c}
.dots i:nth-child(odd){background:#ba0c2f}`;
const URL = 'sevenfriends.io/welcome';
const DOTS = '<div class="dots"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>';
const noise = (c) => c.noise.map((n) => `<span class="n">${n}</span>`).join('');

/** 1200 x 627: the text on the left, the noise crossed out and the poke on the right */
function landscape(c) {
  return `<!doctype html><meta charset="utf-8"><style>${COMMON}
html,body{width:1200px;height:627px;overflow:hidden}
body{display:flex;align-items:center;padding:0 70px;gap:50px}
.l{flex:1.25}
.brand{display:flex;align-items:center;gap:18px;margin-bottom:26px}
.logo{width:84px;height:84px;font-size:44px}
.app{font-size:30px;font-weight:600}
h1{font-size:60px;line-height:1.08;margin-bottom:22px;text-wrap:balance}
p{font-size:26px;line-height:1.45}
.r{flex:1;display:flex;flex-direction:column;align-items:center;gap:10px}
.n{font-size:22px}.ar{font-size:30px}.c{font-size:32px}
.dots{margin-top:22px}
.url{left:70px;font-size:28px}
</style>
<div class="l"><div class="brand"><div class="logo">7</div><div class="app">${c.app}</div></div><h1>${c.head.replace(/<br>/g, " ")}</h1><p>${c.line}</p></div>
<div class="r">${noise(c)}<div class="ar">↓</div><div class="c"><i></i>${c.who} is poking you</div>${DOTS}</div><div class="url">${URL}</div>`;
}

/** 1080 x 1080: one column, everything in the middle */
function square(c) {
  return `<!doctype html><meta charset="utf-8"><style>${COMMON}
html,body{width:1080px;height:1080px;overflow:hidden}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 80px}
.logo{width:120px;height:120px;font-size:62px}
.app{font-size:32px;font-weight:600;margin-top:16px}
h1{font-size:84px;line-height:1.06;margin:30px 0 22px}
p{font-size:30px;line-height:1.45;max-width:860px}
.noise{margin-top:50px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.n{font-size:24px}.ar{font-size:34px;margin:10px 0}.c{font-size:38px}
.dots{margin-top:44px}
.url{left:0;right:0;top:980px;text-align:center;font-size:34px}
</style>
<div class="logo">7</div><div class="app">${c.app}</div><h1>${c.head}</h1><p>${c.line}</p>
<div class="noise">${noise(c)}</div><div class="ar">↓</div><div class="c"><i></i>${c.who} is poking you</div>${DOTS}<div class="url">${URL}</div>`;
}

const jobs = Object.entries(CIRCLES).map(([id, c]) => [`${id}-1200x627`, landscape(c), 1200, 627]);
jobs.push(['friends-1080x1080', square(CIRCLES.friends), 1080, 1080]);
for (const [name, html, w, h] of jobs) {
  const file = join(here, 'html', `${name}.html`);
  writeFileSync(file, html);
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${w},${h}`, `--screenshot=${join(here, name + '.png')}`, pathToFileURL(file).href], { stdio: 'ignore' });
  console.log('made', name + '.png');
}
