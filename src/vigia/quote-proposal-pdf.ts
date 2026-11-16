import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFEmbeddedPage } from 'pdf-lib';
import { pesos, type ProposalContent } from './quote-proposal.js';

// AGT-003 — Dibuja la propuesta en PDF (entrega 4; Juan, 2026-11-16). El contenido lo decide quote-proposal.js; aquí
// sólo va la forma. Se arma en el navegador con pdf-lib, sin servidor de por medio. El logo es el vectorial que entregó
// Juan (`public/marca/logo-seguridad-nacional.pdf`), recortado a su ArtBox para que no traiga el margen blanco del
// lienzo de Illustrator. Juan pidió que la propuesta fuera mejor que la de Papeles Nacionales: hoja carta, la marca
// arriba, tablas legibles, los totales a la vista, condiciones explícitas y página numerada.

const LOGO_URL = '/marca/logo-seguridad-nacional.pdf';
// ArtBox del logo (el dibujo dentro del lienzo de 1080 × 1080).
const LOGO_BOX = { left: 70.85, bottom: 370.72, right: 1009.15, top: 709.28 };

const PAGE = { width: 612, height: 792 }; // carta
const MARGIN = 54;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_SPACE = 48;
const TOTALS_SPACE = 3 * 20 + 14; // tres renglones de totales

const BRAND = rgb(50 / 255, 81 / 255, 145 / 255); // el azul del logo, #325191
const BRAND_SOFT = rgb(0.93, 0.95, 0.98);
const INK = rgb(0.13, 0.15, 0.2);
const MUTED = rgb(0.4, 0.43, 0.5);
const RULE = rgb(0.82, 0.85, 0.9);

type Column = { title: string; width: number; align?: 'left' | 'right' | 'center' };

class Writer {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  logo: PDFEmbeddedPage | null;
  page: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont, logo: PDFEmbeddedPage | null) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.logo = logo;
    this.page = this.addPage();
  }

  addPage(): PDFPage {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = PAGE.height - MARGIN;
    if (this.pages.length > 1) {
      // Las páginas siguientes llevan la marca chica arriba, para que una hoja suelta se sepa de quién es.
      if (this.logo) {
        const width = 96;
        const height = width * (this.logo.height / this.logo.width);
        this.page.drawPage(this.logo, { x: MARGIN, y: this.y - height, width, height });
        this.y -= height + 18;
      }
    }
    return this.page;
  }

  /** Deja al menos `height` puntos libres antes del pie; si no hay, pasa de página. */
  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_SPACE) this.addPage();
  }

  /** Quita lo que la fuente estándar no puede escribir (emojis, flechas): mejor un carácter menos que un PDF roto. */
  safe(text: string, font: PDFFont = this.regular) {
    const set = new Set(font.getCharacterSet());
    return Array.from(String(text ?? '').replace(/\s+/g, ' ')).filter(ch => set.has(ch.codePointAt(0) as number)).join('');
  }

  width(text: string, size: number, font: PDFFont = this.regular) { return font.widthOfTextAtSize(this.safe(text, font), size); }

  wrap(text: string, size: number, maxWidth: number, font: PDFFont = this.regular) {
    const words = this.safe(text, font).split(' ').filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  text(text: string, x: number, y: number, { size = 10, font = this.regular, color = INK } = {}) {
    this.page.drawText(this.safe(text, font), { x, y, size, font, color });
  }

  paragraph(text: string, { size = 10, font = this.regular, color = INK, gap = 6, indent = 0 } = {}) {
    const lines = this.wrap(text, size, CONTENT_WIDTH - indent, font);
    const leading = size * 1.4;
    for (const line of lines) {
      this.ensure(leading);
      this.text(line, MARGIN + indent, this.y - size, { size, font, color });
      this.y -= leading;
    }
    this.y -= gap;
  }

  heading(text: string) {
    this.ensure(60);
    this.y -= 8;
    this.page.drawRectangle({ x: MARGIN, y: this.y - 14, width: 4, height: 16, color: BRAND });
    this.text(text, MARGIN + 12, this.y - 12, { size: 13, font: this.bold, color: BRAND });
    this.y -= 26;
  }

  /** `keepWithNext`: espacio que necesita lo que sigue (los totales), para que la última fila no quede sola. */
  table(columns: Column[], rows: string[][], keepWithNext = 0) {
    const size = 9;
    const pad = 5;
    const leading = size * 1.35;
    const drawHeader = () => {
      const height = leading + pad * 2;
      this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: CONTENT_WIDTH, height, color: BRAND });
      let x = MARGIN;
      for (const column of columns) {
        this.cell(column.title, x, this.y - pad - size, column, { size, font: this.bold, color: rgb(1, 1, 1) });
        x += column.width;
      }
      this.y -= height;
    };
    this.ensure(70);
    drawHeader();
    rows.forEach((row, index) => {
      const wrapped = row.map((value, i) => this.wrap(value, size, columns[i].width - pad * 2));
      const height = Math.max(...wrapped.map(lines => lines.length)) * leading + pad * 2;
      const needed = height + (index === rows.length - 1 ? keepWithNext : 0);
      if (this.y - needed < MARGIN + FOOTER_SPACE) { this.addPage(); drawHeader(); }
      if (index % 2 === 1) this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: CONTENT_WIDTH, height, color: BRAND_SOFT });
      let x = MARGIN;
      wrapped.forEach((lines, i) => {
        lines.forEach((line, n) => this.cell(line, x, this.y - pad - size - n * leading, columns[i], { size }));
        x += columns[i].width;
      });
      this.y -= height;
    });
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + CONTENT_WIDTH, y: this.y }, thickness: 0.8, color: RULE });
    this.y -= 8;
  }

  cell(text: string, x: number, y: number, column: Column, { size = 9, font = this.regular, color = INK } = {}) {
    const pad = 5;
    const width = this.width(text, size, font);
    const left = column.align === 'right' ? x + column.width - pad - width : column.align === 'center' ? x + (column.width - width) / 2 : x + pad;
    this.text(text, left, y, { size, font, color });
  }

  /** Renglones de totales alineados a la derecha; el último, resaltado. */
  totals(lines: { label: string; value: number; strong?: boolean }[]) {
    const size = 10;
    const valueWidth = 110;
    const labelRight = MARGIN + CONTENT_WIDTH - valueWidth - 10;
    this.ensure(lines.length * 18 + 12);
    for (const line of lines) {
      if (line.strong) {
        this.page.drawRectangle({ x: labelRight - 200, y: this.y - 18, width: CONTENT_WIDTH - (labelRight - 200 - MARGIN), height: 20, color: BRAND_SOFT });
      }
      const font = line.strong ? this.bold : this.regular;
      const color = line.strong ? BRAND : INK;
      this.text(line.label, labelRight - this.width(line.label, size, font), this.y - 13, { size, font, color });
      const value = pesos(line.value);
      this.text(value, MARGIN + CONTENT_WIDTH - 5 - this.width(value, size, font), this.y - 13, { size, font, color });
      this.y -= 20;
    }
    this.y -= 6;
  }
}

/** Arma el PDF y devuelve sus bytes. `logoBytes` es el PDF del logo; sin él, la portada lleva el nombre en texto. */
export async function buildProposalPdf(content: ProposalContent, logoBytes: Uint8Array | ArrayBuffer | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Propuesta ${content.number} · ${content.client}`);
  doc.setAuthor(content.company.name);
  doc.setSubject('Propuesta comercial');
  doc.setCreator('CRM Comercial · Seguridad Nacional');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFEmbeddedPage | null = null;
  if (logoBytes) {
    const source = await PDFDocument.load(logoBytes);
    logo = await doc.embedPage(source.getPage(0), LOGO_BOX);
  }
  const w = new Writer(doc, regular, bold, logo);

  // Encabezado: la marca a la izquierda, el número y la fecha a la derecha.
  const top = w.y;
  if (logo) {
    const width = 190;
    const height = width * (logo.height / logo.width);
    w.page.drawPage(logo, { x: MARGIN, y: top - height, width, height });
    w.y = top - height;
  } else {
    w.text(content.company.name, MARGIN, top - 18, { size: 18, font: bold, color: BRAND });
    w.text(content.company.tagline, MARGIN, top - 34, { size: 11, color: BRAND });
    w.y = top - 40;
  }
  const right = MARGIN + CONTENT_WIDTH;
  const label = 'PROPUESTA COMERCIAL';
  w.text(label, right - w.width(label, 11, bold), top - 14, { size: 11, font: bold, color: BRAND });
  w.text(content.number, right - w.width(content.number, 9), top - 30, { size: 9, color: MUTED });
  const dated = `${content.company.city}, ${content.date}`;
  w.text(dated, right - w.width(dated, 9), top - 44, { size: 9, color: MUTED });
  w.y -= 16;
  w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: right, y: w.y }, thickness: 1.2, color: BRAND });
  w.y -= 22;

  // Para quién.
  w.text('Señores', MARGIN, w.y - 9, { size: 9, color: MUTED });
  w.y -= 14;
  w.paragraph(content.client, { size: 14, font: bold, gap: 2 });
  if (content.reference) w.paragraph(`Referencia: ${content.reference}`, { size: 10, color: MUTED, gap: 2 });
  w.y -= 8;
  w.paragraph(content.intro, { size: 10 });

  if (content.guard) {
    w.heading('Servicio de vigilancia');
    w.table(
      [
        { title: 'Puesto', width: 120 },
        { title: 'Horario', width: 70 },
        { title: 'Días', width: 92 },
        { title: 'Guardas', width: 46, align: 'center' },
        { title: 'Modalidad', width: 62 },
        { title: 'Valor mensual', width: CONTENT_WIDTH - 390, align: 'right' },
      ],
      content.guard.rows.map(row => [row.name, row.schedule, row.days, String(row.guards), row.modality, pesos(row.value)]),
      TOTALS_SPACE,
    );
    w.totals([
      { label: 'Valor mensual antes de IVA', value: content.guard.subtotal },
      { label: `IVA sobre el AIU (AIU ${pesos(content.guard.aiu)})`, value: content.guard.iva },
      { label: 'Total mensual', value: content.guard.total, strong: true },
    ]);
  }

  if (content.tech) {
    w.heading('Medios tecnológicos');
    w.table(
      [
        { title: 'Descripción', width: 196 },
        { title: 'Tipo', width: 92 },
        { title: 'Cant.', width: 40, align: 'center' },
        { title: 'Valor unitario', width: 88, align: 'right' },
        { title: 'Valor total', width: CONTENT_WIDTH - 416, align: 'right' },
      ],
      content.tech.rows.map(row => [row.description, row.category, String(row.quantity).replace('.', ','), pesos(row.unitPrice), pesos(row.value)]),
      TOTALS_SPACE,
    );
    w.totals([
      { label: 'Subtotal antes de IVA', value: content.tech.subtotal },
      { label: 'IVA', value: content.tech.iva },
      { label: 'Total (pago único)', value: content.tech.total, strong: true },
    ]);
  }

  if (content.guard && content.tech) {
    w.heading('Resumen de la inversión');
    w.totals([
      { label: 'Vigilancia, cada mes (IVA incluido)', value: content.guard.total },
      { label: 'Medios tecnológicos, una sola vez (IVA incluido)', value: content.tech.total },
    ]);
  }

  w.heading('Condiciones comerciales');
  for (const condition of content.conditions) {
    w.ensure(16);
    w.page.drawCircle({ x: MARGIN + 4, y: w.y - 6.5, size: 1.8, color: BRAND });
    w.paragraph(condition, { size: 10, gap: 2, indent: 14 });
  }

  w.heading('Contacto');
  if (content.seller) {
    w.paragraph(content.seller.name, { size: 10, font: bold, gap: 0 });
    const reach = [content.seller.email, content.seller.phone].filter(Boolean).join(' · ');
    if (reach) w.paragraph(reach, { size: 10, color: MUTED, gap: 0 });
    w.paragraph(content.company.name, { size: 10, color: MUTED });
  } else {
    w.paragraph(content.company.name, { size: 10 });
  }

  // Pie en todas las páginas, con "Página n de m".
  const total = w.pages.length;
  w.pages.forEach((page, index) => {
    w.page = page;
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 14 }, end: { x: right, y: MARGIN + 14 }, thickness: 0.6, color: RULE });
    w.text(`${content.company.name} · NIT ${content.company.nit} · ${content.company.city} · ${content.company.tagline}`, MARGIN, MARGIN, { size: 8, color: MUTED });
    const pageLabel = `Página ${index + 1} de ${total}`;
    w.text(pageLabel, right - w.width(pageLabel, 8), MARGIN, { size: 8, color: MUTED });
  });

  return doc.save();
}

/**
 * En el navegador: trae el logo, arma el PDF y lo descarga. Devuelve el enlace al archivo (vale unos minutos) para que
 * la pantalla lo ofrezca si el navegador no descargó solo.
 */
export async function downloadProposalPdf(content: ProposalContent): Promise<{ url: string; filename: string }> {
  let logoBytes: ArrayBuffer | null = null;
  try {
    const response = await fetch(LOGO_URL);
    if (response.ok) logoBytes = await response.arrayBuffer();
  } catch { /* sin logo, la propuesta lleva el nombre en texto */ }
  const bytes = await buildProposalPdf(content, logoBytes);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const filename = `Propuesta ${content.client} ${content.number}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  return { url, filename };
}
