/**
 * Shows files in the page: PDF, Word (.docx), Excel (.xlsx) and PowerPoint (.pptx). The libraries are big, so each one is loaded
 * only when a file of its kind is opened (they are separate downloads, never part of the app's first load). The files come from a
 * friend, so nothing here runs anything in them: pages are drawn on canvases or built from text, never from the file's own HTML.
 */

/** The biggest file that is shown (a bigger one only gets a Download button): drawing it would freeze a phone. */
export const PREVIEW_LIMIT_BYTES = 15 * 1024 * 1024;

/** A PDF is drawn page by page, at most this many pages. */
const PDF_MAX_PAGES = 40;

/** What a sheet of a spreadsheet shows: at most this many rows and columns. */
export const SHEET_MAX_ROWS = 200;
export const SHEET_MAX_COLUMNS = 30;

/** The pages of a PDF as pictures in `host`. Returns how many pages the PDF has. */
export async function renderPdf(blob: Blob, host: HTMLElement): Promise<number> {
  const pdfjs = await import('pdfjs-dist');
  // the worker is loaded into the page itself (no separate worker file to host): pdf.js finds it as `pdfjsWorker`
  // @ts-ignore the worker file has no types
  await import('pdfjs-dist/build/pdf.worker.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const width = host.clientWidth || 600;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  host.replaceChildren();
  for (let n = 1; n <= Math.min(doc.numPages, PDF_MAX_PAGES); n++) {
    const page = await doc.getPage(n);
    const fit = width / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale: fit * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = 'sf-pdf-page';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`);
    host.append(canvas);
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
  }
  return doc.numPages;
}

/** A Word document (.docx) as pages in `host`. */
export async function renderDocx(blob: Blob, host: HTMLElement): Promise<void> {
  const { renderAsync } = await import('docx-preview');
  host.replaceChildren();
  await renderAsync(blob, host, undefined, { className: 'sf-docx', inWrapper: true, ignoreLastRenderedPageBreak: true, useBase64URL: true });
  // the pages have the width of a sheet of paper: on a narrower screen they are made smaller to fit, so nothing is cut off
  const wrapper = host.querySelector<HTMLElement>('.sf-docx-wrapper');
  const widest = Math.max(0, ...Array.from(host.querySelectorAll<HTMLElement>('section.sf-docx')).map((page) => page.offsetWidth));
  if (wrapper && widest) wrapper.style.zoom = String(Math.min(1, host.clientWidth / (widest + 60)));
}

/** A PowerPoint file (.pptx) as slides under each other in `host`. */
export async function renderPptx(blob: Blob, host: HTMLElement): Promise<void> {
  const { init } = await import('pptx-preview');
  const width = Math.max(host.clientWidth, 280);
  host.replaceChildren();
  const previewer = init(host, { width, height: Math.round((width * 9) / 16), mode: 'list' });
  await previewer.preview(await blob.arrayBuffer());
}

/** One sheet of a spreadsheet: its name and its cells as text (dates written out, empty cells empty). */
export interface SheetView {
  name: string;
  rows: string[][];
  /** true = there were more rows or columns than are shown */
  cut: boolean;
}

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** The number formats that are dates (the built-in ones; a custom format is a date when it has d, m, y, h or s in it). */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** "A" -> 0, "B" -> 1, "AA" -> 26 */
const columnOf = (reference: string) => [...reference.replace(/[^A-Za-z]/g, '').toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** The text of an element, from its <t> parts (rich text has several; the phonetic guide of East Asian text is left out). */
const textOf = (element: Element) =>
  Array.from(element.getElementsByTagName('t'))
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');

/** A date number of Excel (days since 1900) as text. */
function dateText(serial: number): string {
  const date = new Date(Math.round((serial - 25569) * 86_400_000));
  if (Number.isNaN(date.getTime())) return String(serial);
  const day = date.toISOString().slice(0, 10);
  return serial % 1 ? `${day} ${date.toISOString().slice(11, 16)}` : day;
}

/**
 * The sheets of an Excel file (.xlsx), as text only: the file is a zip of XML files, read here directly. Nothing in it is run (no
 * formulas, no macros): a cell shows the value that was saved with it.
 */
export async function readSheets(blob: Blob): Promise<SheetView[]> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const wanted = /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/;
  // only the parts that are read are unpacked, and none of them may be huge (a zip can hide a very big file in a small one)
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: (file) => wanted.test(file.name) && file.originalSize <= 40 * 1024 * 1024 });
  const xml = (name: string) => (files[name] ? new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml') : null);

  const workbook = xml('xl/workbook.xml');
  if (!workbook) throw new Error('Not an Excel file');
  const targets = new Map<string, string>();
  xml('xl/_rels/workbook.xml.rels')
    ?.querySelectorAll('Relationship')
    .forEach((r) => targets.set(r.getAttribute('Id') ?? '', (r.getAttribute('Target') ?? '').replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/')));

  const strings = Array.from(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') ?? []).map(textOf);

  const styles = xml('xl/styles.xml');
  const formats = new Map<number, string>();
  styles?.querySelectorAll('numFmts > numFmt').forEach((f) => formats.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? ''));
  const isDate = Array.from(styles?.querySelectorAll('cellXfs > xf') ?? []).map((xf) => {
    const id = Number(xf.getAttribute('numFmtId'));
    const code = formats.get(id);
    return code === undefined ? DATE_FORMATS.has(id) : /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
  });

  const views: SheetView[] = [];
  for (const sheet of Array.from(workbook.getElementsByTagName('sheet')).slice(0, 20)) {
    const doc = xml(targets.get(sheet.getAttributeNS(SPREADSHEET_NS, 'id') ?? '') ?? '');
    const rows: string[][] = [];
    let cut = false;
    for (const row of Array.from(doc?.getElementsByTagName('row') ?? [])) {
      const at = Number(row.getAttribute('r')) - 1;
      const index = Number.isInteger(at) && at >= 0 ? at : rows.length;
      if (index >= SHEET_MAX_ROWS) {
        cut = true;
        break;
      }
      while (rows.length < index) rows.push([]);
      const cells: string[] = [];
      for (const cell of Array.from(row.getElementsByTagName('c'))) {
        const column = columnOf(cell.getAttribute('r') ?? '');
        if (column >= SHEET_MAX_COLUMNS) {
          cut = true;
          continue;
        }
        const type = cell.getAttribute('t');
        const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
        let text: string;
        if (type === 's') text = strings[Number(raw)] ?? '';
        else if (type === 'inlineStr') text = textOf(cell);
        else if (type === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'str' || type === 'e' || raw === '') text = raw;
        else text = isDate[Number(cell.getAttribute('s'))] ? dateText(Number(raw)) : raw;
        while (cells.length < column) cells.push('');
        cells[column] = text;
      }
      rows[index] = cells;
    }
    views.push({ name: sheet.getAttribute('name') ?? `Sheet ${views.length + 1}`, rows, cut });
  }
  return views;
}
