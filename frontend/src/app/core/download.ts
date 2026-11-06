/** Is this file really on the website? A missing file is answered by the web app's own page (html): that is "not there". */
export async function fileExists(url: string): Promise<boolean> {
  try {
    const reply = await fetch(url, { method: 'HEAD' });
    return reply.ok && !(reply.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}
