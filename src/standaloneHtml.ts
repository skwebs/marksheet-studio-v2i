import JSZip from 'jszip';

const DATA_URL_PATTERN = /^data:|^blob:|^#|^about:/i;
const assetCache = new Map<string, Promise<string>>();
const stylesheetCache = new Map<string, Promise<string>>();
const scriptCache = new Map<string, Promise<string>>();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not embed an image or font asset.'));
    reader.readAsDataURL(blob);
  });
}

async function fetchAssetAsDataUrl(source: string, baseUrl: string): Promise<string> {
  if (DATA_URL_PATTERN.test(source)) return source;
  const absoluteUrl = new URL(source, baseUrl).href;
  let pending = assetCache.get(absoluteUrl);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(absoluteUrl, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Could not embed required asset: ${absoluteUrl}`);
      return blobToDataUrl(await response.blob());
    })();
    assetCache.set(absoluteUrl, pending);
  }
  return pending;
}

async function inlineCssUrls(css: string, baseUrl: string): Promise<string> {
  const matches = [...css.matchAll(/url\((\s*['"]?)(.*?)\1\s*\)/gi)];
  let output = css;
  for (const match of matches) {
    const raw = (match[2] || '').trim();
    if (!raw || DATA_URL_PATTERN.test(raw)) continue;
    const embedded = await fetchAssetAsDataUrl(raw, baseUrl);
    output = output.replace(match[0], `url("${embedded}")`);
  }
  return output;
}

async function inlineStylesheet(link: HTMLLinkElement, doc: Document): Promise<void> {
  const href = link.href;
  let pending = stylesheetCache.get(href);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(href);
      if (!response.ok) throw new Error(`Could not embed stylesheet: ${href}`);
      return inlineCssUrls(await response.text(), href);
    })();
    stylesheetCache.set(href, pending);
  }
  const css = await pending;
  const style = doc.createElement('style');
  style.textContent = css;
  link.replaceWith(style);
}

async function inlineScript(script: HTMLScriptElement): Promise<void> {
  const src = script.src;
  if (!src) return;
  const parsed = new URL(src);
  if (parsed.hostname !== 'cdn.jsdelivr.net' || !parsed.pathname.startsWith('/npm/@tailwindcss/browser@4')) {
    script.remove();
    return;
  }
  let pending = scriptCache.get(src);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`Could not embed required rendering runtime: ${src}`);
      return response.text();
    })();
    scriptCache.set(src, pending);
  }
  script.removeAttribute('src');
  script.textContent = await pending;
  script.removeAttribute('crossorigin');
  script.removeAttribute('integrity');
}

/** Converts a rendered marksheet into a single HTML document with no external assets. */
export async function createStandaloneMarksheetHtml(renderedHtml: string, studentName: string): Promise<string> {
  const doc = new DOMParser().parseFromString(renderedHtml, 'text/html');
  const baseUrl = window.location.href;

  // Inline external stylesheets first so their font files can also be embedded.
  for (const link of [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]) {
    await inlineStylesheet(link, doc);
  }
  doc.querySelectorAll('link[rel="preconnect"], link[rel="dns-prefetch"]').forEach(link => link.remove());

  // The template uses Tailwind's browser runtime to generate utility CSS. Embed it
  // in the file so the exported marksheet renders without a CDN connection.
  for (const script of [...doc.querySelectorAll<HTMLScriptElement>('script[src]')]) {
    await inlineScript(script);
  }

  // Embed any relative, same-origin or remote image resources remaining in markup.
  for (const image of [...doc.querySelectorAll<HTMLImageElement>('img[src]')]) {
    const src = image.getAttribute('src') || '';
    if (!src || DATA_URL_PATTERN.test(src)) continue;
    image.src = await fetchAssetAsDataUrl(src, baseUrl);
  }

  // Inline URL references inside template and generated watermark styles.
  for (const style of [...doc.querySelectorAll<HTMLStyleElement>('style')]) {
    style.textContent = await inlineCssUrls(style.textContent || '', baseUrl);
  }

  // No linked resources should remain in the final document.
  doc.querySelectorAll('link[rel="stylesheet"], script[src]').forEach(node => node.remove());
  doc.querySelectorAll('[src], [href]').forEach(element => {
    for (const attribute of ['src', 'href']) {
      const value = element.getAttribute(attribute);
      if (value && /^https?:\/\//i.test(value) && !DATA_URL_PATTERN.test(value)) {
        throw new Error(`Standalone export still contains an external resource: ${value}`);
      }
    }
  });

  const safeStudentName = studentName.replace(/[<>\r\n]/g, '').trim();
  doc.title = `Marksheet - ${safeStudentName || 'Student'}`;
  const metadata = doc.createElement('meta');
  metadata.name = 'generator';
  metadata.content = 'Marksheet Studio V2 · Standalone HTML export';
  doc.head.append(metadata);
  const comment = doc.createComment(` Standalone marksheet exported from Marksheet Studio V2 on ${new Date().toISOString()}. All required assets are embedded. `);
  doc.documentElement.insertBefore(comment, doc.documentElement.firstChild);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

export async function createStandaloneMarksheetZip(
  entries: Array<{ fileName: string; html: string }>
): Promise<Blob> {
  if (!entries.length) throw new Error('There are no marksheets to export.');
  const zip = new JSZip();
  const usedNames = new Map<string, number>();
  for (const entry of entries) {
    const count = usedNames.get(entry.fileName) || 0;
    usedNames.set(entry.fileName, count + 1);
    const fileName = count === 0 ? entry.fileName : entry.fileName.replace(/\.html$/i, `-${count + 1}.html`);
    zip.file(fileName, entry.html);
  }
  zip.file('README.txt', 'Standalone Marksheet Studio V2 exports. Each HTML file contains its own marksheet, rendering styles, fonts, QR code, photographs, logos, watermark and signature images. Open an HTML file in a modern browser; internet access is not required after export. Use the browser print command to print the A4 marksheet.\n');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const verified = await JSZip.loadAsync(blob);
  if (Object.keys(verified.files).filter(name => name.toLowerCase().endsWith('.html')).length !== entries.length) {
    throw new Error('HTML ZIP verification failed: one or more marksheets are missing.');
  }
  return blob;
}

export function standaloneFileName(roll: string, studentName: string): string {
  const safe = (value: string) => value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'student';
  return `${safe(roll)}-${safe(studentName)}.html`;
}
