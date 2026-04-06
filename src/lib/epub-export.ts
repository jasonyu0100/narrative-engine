import type { NarrativeState, Scene } from '@/types/narrative';
import { resolveEntry, isScene } from '@/types/narrative';
import { resolveProseForBranch } from '@/lib/narrative-utils';

// ── CRC-32 ────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Minimal ZIP Writer (stored, no compression) ───────────────────────────────

type ZipEntry = { name: string; data: Uint8Array };

const enc = new TextEncoder();

function u16(v: DataView, o: number, n: number) { v.setUint16(o, n, true); }
function u32(v: DataView, o: number, n: number) { v.setUint32(o, n, true); }

function buildZip(entries: ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const dir: { nameBytes: Uint8Array; crc: number; size: number; localOffset: number }[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0); u16(lv, 8, 0);
    u16(lv, 10, 0); u16(lv, 12, 0); u32(lv, 14, crc); u32(lv, 18, size);
    u32(lv, 22, size); u16(lv, 26, nameBytes.length); u16(lv, 28, 0);
    lh.set(nameBytes, 30);
    dir.push({ nameBytes, crc, size, localOffset: offset });
    offset += lh.length + size;
    parts.push(lh, entry.data);
  }

  const cdOffset = offset;
  for (const e of dir) {
    const cd = new Uint8Array(46 + e.nameBytes.length);
    const cv = new DataView(cd.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0);
    u16(cv, 10, 0); u16(cv, 12, 0); u16(cv, 14, 0); u32(cv, 16, e.crc);
    u32(cv, 20, e.size); u32(cv, 24, e.size); u16(cv, 28, e.nameBytes.length);
    u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0);
    u32(cv, 38, 0); u32(cv, 42, e.localOffset);
    cd.set(e.nameBytes, 46);
    offset += cd.length;
    parts.push(cd);
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0);
  u16(ev, 8, entries.length); u16(ev, 10, entries.length);
  u32(ev, 12, offset - cdOffset); u32(ev, 16, cdOffset); u16(ev, 20, 0);
  parts.push(eocd);

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// ── EPUB Content Builders ─────────────────────────────────────────────────────

function x(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildChapterXhtml(title: string, scenes: { scene: Scene; prose: string; narrative: NarrativeState }[]): string {
  const body = scenes.map(({ scene, prose, narrative: n }, si) => {
    const loc = n.locations[scene.locationId];
    const pov = n.characters[scene.povId ?? ''];
    const metaParts = [loc?.name, pov ? `POV: ${pov.name}` : null].filter(Boolean);
    const meta = metaParts.length > 0 ? `  <p class="scene-meta">${x(metaParts.join(' · '))}</p>\n` : '';
    const sep = si > 0 ? '  <p class="scene-break">* * *</p>\n' : '';
    const paras = prose
      .split('\n\n')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p, pi) => `  <p${si === 0 && pi === 0 ? ' class="first"' : ''}>${x(p)}</p>`)
      .join('\n');
    return `${sep}${meta}${paras}`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${x(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <section epub:type="chapter">
  <h1>${x(title)}</h1>
${body}
  </section>
</body>
</html>`;
}

const STYLE = `body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1em;
  line-height: 1.8;
  color: #1a1a1a;
}
section {
  margin: 0 auto;
  max-width: 36em;
  padding: 3em 1.5em;
}
h1 {
  font-size: 1.4em;
  font-weight: normal;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #444;
  margin-bottom: 2.5em;
}
p {
  margin: 0;
  text-indent: 1.5em;
}
p + p {
  margin-top: 0;
}
p.first {
  text-indent: 0;
}
p.first::first-letter {
  font-size: 3em;
  line-height: 0.8;
  float: left;
  margin: 0.06em 0.08em 0 0;
  font-weight: 600;
  color: #222;
}
p.scene-break {
  text-align: center;
  text-indent: 0;
  margin: 2em 0;
  color: #aaa;
  letter-spacing: 0.3em;
  font-size: 0.8em;
}
p.scene-meta {
  text-indent: 0;
  font-size: 0.72em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #888;
  margin-bottom: 1.2em;
  margin-top: 0.5em;
}`;

// ── Public Export Function ────────────────────────────────────────────────────

export function exportEpub(
  narrative: NarrativeState,
  resolvedKeys: string[],
  branchId: string,
  proseCache: Record<string, { text: string; status: string }>,
): void {
  const allScenes = resolvedKeys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && isScene(e));

  const branches = narrative.branches;

  // Group scenes by arc in order of first appearance
  const arcOrder: string[] = [];
  const arcSceneMap: Record<string, { scene: Scene; prose: string; narrative: NarrativeState }[]> = {};

  for (const scene of allScenes) {
    const { prose: resolvedProse } = resolveProseForBranch(scene, branchId, branches);
    const prose = proseCache[scene.id]?.status === 'ready'
      ? proseCache[scene.id].text
      : resolvedProse ?? '';
    if (!prose) continue;

    const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));
    const arcId = arc?.id ?? '__ungrouped__';
    if (!arcOrder.includes(arcId)) arcOrder.push(arcId);
    (arcSceneMap[arcId] ??= []).push({ scene, prose, narrative });
  }

  if (arcOrder.length === 0) return;

  type Chapter = { id: string; title: string; filename: string; xhtml: string };
  const chapters: Chapter[] = arcOrder.map((arcId, i) => {
    const arc = narrative.arcs[arcId];
    const title = arc?.name ?? 'Untitled';
    const filename = `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;
    return {
      id: `ch${i + 1}`,
      title,
      filename,
      xhtml: buildChapterXhtml(title, arcSceneMap[arcId]),
    };
  });

  const bookId = `urn:uuid:${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${x(bookId)}</dc:identifier>
    <dc:title>${x(narrative.title)}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${chapters.map((c) => `    <item id="${c.id}" href="${c.filename}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${chapters.map((c) => `    <itemref idref="${c.id}"/>`).join('\n')}
  </spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="UTF-8"/><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${chapters.map((c) => `      <li><a href="${c.filename}">${x(c.title)}</a></li>`).join('\n')}
    </ol>
  </nav>
</body>
</html>`;

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${x(bookId)}"/></head>
  <docTitle><text>${x(narrative.title)}</text></docTitle>
  <navMap>
${chapters.map((c, i) => `    <navPoint id="${c.id}" playOrder="${i + 1}">
      <navLabel><text>${x(c.title)}</text></navLabel>
      <content src="${c.filename}"/>
    </navPoint>`).join('\n')}
  </navMap>
</ncx>`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const e = (s: string) => enc.encode(s);

  const entries: ZipEntry[] = [
    { name: 'mimetype', data: e('application/epub+zip') },
    { name: 'META-INF/container.xml', data: e(container) },
    { name: 'OEBPS/content.opf', data: e(opf) },
    { name: 'OEBPS/nav.xhtml', data: e(nav) },
    { name: 'OEBPS/toc.ncx', data: e(ncx) },
    { name: 'OEBPS/style.css', data: e(STYLE) },
    ...chapters.map((c) => ({ name: `OEBPS/${c.filename}`, data: e(c.xhtml) })),
  ];

  const zipBytes = buildZip(entries);
  const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/epub+zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${narrative.title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase()}.epub`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
