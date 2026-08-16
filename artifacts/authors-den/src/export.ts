import { Document, Packer, Paragraph, AlignmentType, HeadingLevel, TextRun } from "docx";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

// Client-side manuscript export. Every format is generated in the browser so
// projects never have to leave the local desk: plain-text-ish formats are
// hand-written (txt, md, html, rtf, doc, fdx), the office formats use small
// libraries (docx, pdf, epub, odt), and print opens a print-ready window.

export type ExportFormat =
  | "docx" | "pdf" | "epub" | "rtf" | "txt" | "html" | "fdx" | "md" | "odt" | "doc" | "json" | "print";

export interface ExportScene { id?: string; title: string; synopsis?: string; content: string; status?: string; pov?: string; }
export interface ExportProject {
  id?: string; title: string; author?: string; template?: string;
  premise?: string; synopsis?: string; summary?: string; created?: string; updated?: string;
  scenes: ExportScene[];
}

type Block = { type: "p" | "h1" | "h2" | "h3" | "li" | "quote" | "code"; text: string; md: string };

const slug = (value: string) => (value.trim().replace(/\s+/g, "-").toLowerCase().replace(/[^a-z0-9-]+/g, "").replace(/^-+|-+$/g, "") || "manuscript");
const htmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rtfEscape = (value: string) => value.replace(/[\\{}]/g, (ch) => `\\${ch}`).replace(/[^\x00-\x7F]/g, (ch) => `\\u${ch.codePointAt(0) ?? ch.charCodeAt(0)}?`);
const stripMd = (value: string) => value.replace(/\*\*/g, "").replace(/_(?=[^_\n]*_)/g, "").replace(/_/g, "").replace(/\n+/g, " ").trim();

// Parse the editor's rich-text HTML into semantic blocks, extracting both a
// plain version (for txt/rtf/pdf/docx) and a markdown version (for md/epub).
function htmlBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(`<div id="__r">${html}</div>`, "text/html");
  const root = doc.getElementById("__r");
  if (!root || !root.children.length) {
    const plain = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    return plain ? [{ type: "p", text: plain, md: plain }] : [];
  }
  const inline = (el: Element, md: boolean): string => {
    let out = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? "";
      else if (node.nodeType === Node.ELEMENT_NODE) {
        const e = node as Element;
        const tag = e.tagName.toLowerCase();
        if (tag === "br") out += md ? "\n" : " ";
        else if (tag === "b" || tag === "strong") out += md ? `**${inline(e, true)}**` : inline(e, false);
        else if (tag === "i" || tag === "em") out += md ? `_${inline(e, true)}_` : inline(e, false);
        else out += inline(e, md);
      }
    }
    return out;
  };
  const blocks: Block[] = [];
  const headingType = (tag: string): Block["type"] => (tag === "h1" ? "h1" : tag === "h2" ? "h2" : "h3");
  const walk = (node: Element) => {
    for (const nodeChild of Array.from(node.childNodes)) {
      if (nodeChild.nodeType !== Node.ELEMENT_NODE) continue;
      const e = nodeChild as Element;
      const tag = e.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") { for (const li of Array.from(e.children)) if (li.tagName.toLowerCase() === "li") { const md = inline(li, true).trim(); if (md) blocks.push({ type: "li", text: stripMd(md), md }); } continue; }
      if (tag === "li") { const md = inline(e, true).trim(); if (md) blocks.push({ type: "li", text: stripMd(md), md }); continue; }
      if (tag === "blockquote") { const md = inline(e, true).trim(); if (md) blocks.push({ type: "quote", text: stripMd(md), md }); continue; }
      if (tag === "pre") { const text = (e.textContent ?? "").trim(); if (text) blocks.push({ type: "code", text, md: text }); continue; }
      if (tag === "p" || tag === "div" || tag === "section" || tag === "article") { const md = inline(e, true).trim(); if (md) blocks.push({ type: "p", text: stripMd(md), md }); continue; }
      if (/^h[1-6]$/.test(tag)) { const md = inline(e, true).trim(); if (md) blocks.push({ type: headingType(tag), text: stripMd(md), md }); continue; }
      walk(e);
    }
  };
  walk(root);
  return blocks;
}

function toText(project: ExportProject): string {
  const parts: string[] = [project.title];
  if (project.author) parts.push(project.author);
  if (project.premise) parts.push(`\n${project.premise}`);
  for (const scene of project.scenes) {
    parts.push(`\n\n${scene.title}`);
    for (const block of htmlBlocks(scene.content)) parts.push(block.text);
  }
  return parts.filter(Boolean).join("\n\n");
}

function toMarkdown(project: ExportProject): string {
  const parts: string[] = [`# ${project.title}`];
  if (project.author) parts.push(`_${project.author}_`);
  if (project.premise) parts.push(`> ${project.premise}`);
  for (const scene of project.scenes) {
    parts.push(`\n## ${scene.title}`);
    if (scene.synopsis) parts.push(`_${scene.synopsis}_`);
    for (const block of htmlBlocks(scene.content)) {
      if (block.type === "h1") parts.push(`### ${block.md}`);
      else if (block.type === "h2") parts.push(`#### ${block.md}`);
      else if (block.type === "h3") parts.push(`##### ${block.md}`);
      else if (block.type === "li") parts.push(`- ${block.md}`);
      else if (block.type === "quote") parts.push(`> ${block.md}`);
      else if (block.type === "code") parts.push(`\`\`\`\n${block.text}\n\`\`\``);
      else if (block.md) parts.push(block.md);
    }
  }
  return parts.join("\n\n");
}

function toRtf(project: ExportProject): string {
  const lines: string[] = [`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\colortbl;}\\f0\\fs24`];
  lines.push(`\\pard\\qc\\b\\fs36 ${rtfEscape(project.title)}\\b0\\par`);
  if (project.author) lines.push(`\\pard\\qc\\i\\fs24 ${rtfEscape(project.author)}\\i0\\par`);
  if (project.premise) lines.push(`\\pard\\i\\fs22 ${rtfEscape(project.premise)}\\i0\\par`);
  for (const scene of project.scenes) {
    lines.push(`\\pard\\b\\fs28 ${rtfEscape(scene.title)}\\b0\\par`);
    for (const block of htmlBlocks(scene.content)) {
      const lead = block.type === "quote" ? "\\pard\\i " : block.type === "li" ? "\\pard\\bullet\\tab " : "\\pard ";
      lines.push(`${lead}${rtfEscape(block.text)}\\par`);
    }
  }
  lines.push("}");
  return lines.join("\r\n");
}

function toFdx(project: ExportProject): string {
  const lines: string[] = [`<?xml version="1.0" encoding="UTF-8"?>`, `<FinalDraft DocumentType="Script" Template="No" Version="1">`, `  <Content>`];
  project.scenes.forEach((scene, index) => {
    lines.push(`    <Scene Number="${index + 1}" Title="${htmlEscape(scene.title)}">`);
    lines.push(`      <Paragraph Type="Scene Heading"><Text>${htmlEscape(scene.title)}</Text></Paragraph>`);
    for (const block of htmlBlocks(scene.content)) {
      lines.push(`      <Paragraph Type="Action"><Text>${htmlEscape(block.text)}</Text></Paragraph>`);
    }
    lines.push(`    </Scene>`);
  });
  lines.push(`  </Content>`, `</FinalDraft>`);
  return lines.join("\n");
}

function htmlDocument(project: ExportProject): string {
  const sceneHtml = project.scenes.map((scene) => {
    const body = htmlBlocks(scene.content).map((block) => {
      if (block.type === "h1") return `<h1>${htmlEscape(block.text)}</h1>`;
      if (block.type === "h2") return `<h2>${htmlEscape(block.text)}</h2>`;
      if (block.type === "h3") return `<h3>${htmlEscape(block.text)}</h3>`;
      if (block.type === "li") return `<li>${htmlEscape(block.text)}</li>`;
      if (block.type === "quote") return `<blockquote>${htmlEscape(block.text)}</blockquote>`;
      if (block.type === "code") return `<pre>${htmlEscape(block.text)}</pre>`;
      return `<p>${htmlEscape(block.text)}</p>`;
    }).join("\n");
    return `<section class="scene"><h2 class="scene-title">${htmlEscape(scene.title)}</h2>${body}</section>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${htmlEscape(project.title)}</title><style>body{font:16px/1.75 Georgia,'Times New Roman',serif;color:#1a1a1a;max-width:720px;margin:0 auto;padding:48px 24px;}h1{font-size:30px;text-align:center;margin:0 0 6px;}h2.scene-title{border-bottom:1px solid #ccc;padding-bottom:6px;margin:42px 0 16px;}h1,h2,h3{font-family:Georgia,serif;}p{margin:0 0 1em;}blockquote{border-left:3px solid #999;margin:1em 0;padding-left:16px;color:#444;}li{margin-bottom:6px;}pre{background:#f4f4f4;padding:12px;overflow:auto;font:13px/1.5 'Courier New',monospace;}.meta{text-align:center;color:#666;margin:0 0 8px;}</style></head><body><h1>${htmlEscape(project.title)}</h1>${project.author ? `<p class="meta">${htmlEscape(project.author)}</p>` : ""}${project.premise ? `<p class="meta">${htmlEscape(project.premise)}</p>` : ""}${sceneHtml}</body></html>`;
}

// Count every word in the manuscript so the cover page can report it.
function wordCount(project: ExportProject): number {
  let count = 0;
  for (const scene of project.scenes) {
    for (const block of htmlBlocks(scene.content)) count += block.text.split(/\s+/).filter(Boolean).length;
  }
  return count;
}

async function toDocx(project: ExportProject): Promise<Blob> {
  const children: Paragraph[] = [];
  // --- Cover page ---
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2600, after: 320 }, children: [new TextRun({ text: project.title, bold: true, size: 48, font: "Georgia" })] }));
  if (project.author) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 520 }, children: [new TextRun({ text: `by ${project.author}`, italics: true, size: 24 })] }));
  if (project.premise) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 560, after: 120 }, children: [new TextRun({ text: "PREMISE", bold: true, size: 15, color: "777777" })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 }, children: [new TextRun({ text: project.premise, italics: true, size: 20 })] }));
  }
  if (project.synopsis) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: "SYNOPSIS", bold: true, size: 15, color: "777777" })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 }, children: [new TextRun({ text: project.synopsis, italics: true, size: 20 })] }));
  }
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400, after: 120 }, children: [new TextRun({ text: "WORD COUNT", bold: true, size: 15, color: "777777" })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: `${wordCount(project).toLocaleString()} words`, size: 20 })] }));
  children.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0 } }));
  // --- Manuscript ---
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: project.title, bold: true, size: 34, font: "Georgia" })] }));
  if (project.author) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: project.author, italics: true, size: 22 })] }));
  if (project.premise) children.push(new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: project.premise, italics: true, size: 20 })] }));
  for (const scene of project.scenes) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 }, children: [new TextRun({ text: scene.title, bold: true, size: 28 })] }));
    for (const block of htmlBlocks(scene.content)) {
      if (block.type === "h1") children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: block.text, bold: true })] }));
      else if (block.type === "h2") children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: block.text, bold: true })] }));
      else if (block.type === "quote") children.push(new Paragraph({ indent: { left: 720 }, spacing: { after: 120 }, children: [new TextRun({ text: block.text, italics: true })] }));
      else if (block.type === "li") children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(block.text)] }));
      else if (block.type === "code") children.push(new Paragraph({ children: [new TextRun({ text: block.text, font: "Courier New" })] }));
      else if (block.text) children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun(block.text)] }));
    }
  }
  const document = new Document({ sections: [{ properties: {}, children }] });
  return Packer.toBlob(document);
}

async function toPdf(project: ExportProject): Promise<Blob> {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 72;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  let y = margin;
  const ensure = (needed: number) => { if (y + needed > pageHeight - margin) { pdf.addPage(); y = margin; } };
  const add = (text: string, size: number, style: "normal" | "bold" | "italic" | "bolditalic", gap = 4) => {
    pdf.setFont("times", style);
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      ensure(size + gap);
      pdf.text(String(line), margin, y);
      y += size + gap;
    }
  };
  const centerText = (text: string, size: number, style: "normal" | "bold" | "italic" | "bolditalic", startY: number) => {
    pdf.setFont("times", style);
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text, contentWidth);
    let yy = startY;
    for (const line of lines) {
      const width = pdf.getTextWidth(String(line));
      pdf.text(String(line), (pageWidth - width) / 2, yy);
      yy += size + 5;
    }
    return yy;
  };
  // --- Cover page ---
  let coverY = pageHeight * 0.26;
  coverY = centerText(project.title, 32, "bold", coverY) + 28;
  if (project.author) coverY = centerText(`by ${project.author}`, 14, "italic", coverY) + 60;
  if (project.premise) {
    coverY = centerText("PREMISE", 10.5, "bold", coverY) + 18;
    coverY = centerText(project.premise, 12, "italic", coverY) + 32;
  }
  if (project.synopsis) {
    coverY = centerText("SYNOPSIS", 10.5, "bold", coverY) + 18;
    coverY = centerText(project.synopsis, 12, "italic", coverY) + 32;
  }
  coverY = centerText("WORD COUNT", 10.5, "bold", coverY) + 18;
  centerText(`${wordCount(project).toLocaleString()} words`, 13, "normal", coverY);
  // --- Manuscript on a fresh page ---
  pdf.addPage();
  y = margin;
  add(project.title, 24, "bold", 6);
  if (project.author) add(project.author, 12, "italic", 6);
  if (project.premise) { y += 8; add(project.premise, 11, "italic", 6); }
  for (const scene of project.scenes) {
    ensure(40); y += 14; add(scene.title, 15, "bold", 6);
    for (const block of htmlBlocks(scene.content)) {
      if (block.type === "quote") add(block.text, 11, "italic");
      else if (block.type === "li") add(`• ${block.text}`, 11, "normal");
      else add(block.text, 11.5, "normal");
    }
    y += 8;
  }
  return pdf.output("blob");
}

async function toEpub(project: ExportProject): Promise<Blob> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF")!.file("container.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const chapters = project.scenes.map((scene, index) => {
    const body = htmlBlocks(scene.content).map((block) => {
      if (block.type === "h1") return `<h2>${htmlEscape(block.text)}</h2>`;
      if (block.type === "h2") return `<h3>${htmlEscape(block.text)}</h3>`;
      if (block.type === "h3") return `<h4>${htmlEscape(block.text)}</h4>`;
      if (block.type === "li") return `<li>${htmlEscape(block.md.replace(/^[-*]\s/, ""))}</li>`;
      if (block.type === "quote") return `<blockquote><p>${htmlEscape(block.text)}</p></blockquote>`;
      if (block.type === "code") return `<pre>${htmlEscape(block.text)}</pre>`;
      return `<p>${htmlEscape(block.text)}</p>`;
    }).join("\n");
    return { id: `chapter${index + 1}`, title: scene.title, body };
  });
  const nav = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${htmlEscape(project.title)}</title></head><body><nav epub:type="toc"><h1>${htmlEscape(project.title)}</h1><ol>${chapters.map((chapter) => `<li><a href="${chapter.id}.xhtml">${htmlEscape(chapter.title)}</a></li>`).join("")}</ol></nav></body></html>`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${project.id ?? Math.random().toString(36).slice(2)}</dc:identifier><dc:title>${htmlEscape(project.title)}</dc:title>${project.author ? `<dc:creator>${htmlEscape(project.author)}</dc:creator>` : ""}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((chapter) => `<item id="${chapter.id}" href="${chapter.id}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map((chapter) => `<itemref idref="${chapter.id}"/>`).join("")}</spine></package>`;
  zip.folder("OEBPS")!.file("content.opf", opf);
  zip.folder("OEBPS")!.file("nav.xhtml", nav);
  chapters.forEach((chapter) => zip.folder("OEBPS")!.file(`${chapter.id}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>${htmlEscape(chapter.title)}</title></head><body><h1>${htmlEscape(chapter.title)}</h1>\n${chapter.body}</body></html>`));
  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
}

async function toOdt(project: ExportProject): Promise<Blob> {
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
  zip.folder("META-INF")!.file("manifest.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>`);
  zip.file("styles.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2"><office:styles/></office:document-styles>`);
  const body: string[] = [];
  body.push(`<text:h text:outline-level="1">${htmlEscape(project.title)}</text:h>`);
  if (project.author) body.push(`<text:p>${htmlEscape(project.author)}</text:p>`);
  if (project.premise) body.push(`<text:p>${htmlEscape(project.premise)}</text:p>`);
  for (const scene of project.scenes) {
    body.push(`<text:h text:outline-level="2">${htmlEscape(scene.title)}</text:h>`);
    for (const block of htmlBlocks(scene.content)) {
      if (block.type === "li") body.push(`<text:list><text:list-item><text:p>${htmlEscape(block.text)}</text:p></text:list-item></text:list>`);
      else if (block.type === "code") body.push(`<text:p>${htmlEscape(block.text)}</text:p>`);
      else body.push(`<text:p>${htmlEscape(block.text)}</text:p>`);
    }
  }
  zip.file("content.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text>${body.join("")}</office:text></office:body></office:document-content>`);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.oasis.opendocument.text", compression: "DEFLATE" });
}

function download(blob: Blob, filename: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function printProject(project: ExportProject) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.open();
  win.document.write(htmlDocument(project));
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch { /* popup may block print in some browsers */ } }, 300);
}

export async function exportProject(project: ExportProject, format: ExportFormat): Promise<void> {
  const name = slug(project.title);
  switch (format) {
    case "json": download(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), `${name}.msk.json`); break;
    case "txt": download(new Blob([toText(project)], { type: "text/plain;charset=utf-8" }), `${name}.txt`); break;
    case "md": download(new Blob([toMarkdown(project)], { type: "text/markdown;charset=utf-8" }), `${name}.md`); break;
    case "html": download(new Blob([htmlDocument(project)], { type: "text/html;charset=utf-8" }), `${name}.html`); break;
    case "rtf": download(new Blob([toRtf(project)], { type: "application/rtf" }), `${name}.rtf`); break;
    // .doc carries RTF content — Microsoft Word and LibreOffice open it.
    case "doc": download(new Blob([toRtf(project)], { type: "application/msword" }), `${name}.doc`); break;
    case "fdx": download(new Blob([toFdx(project)], { type: "text/xml;charset=utf-8" }), `${name}.fdx`); break;
    case "docx": download(await toDocx(project), `${name}.docx`); break;
    case "pdf": download(await toPdf(project), `${name}.pdf`); break;
    case "epub": download(await toEpub(project), `${name}.epub`); break;
    case "odt": download(await toOdt(project), `${name}.odt`); break;
    case "print": printProject(project); break;
  }
}
