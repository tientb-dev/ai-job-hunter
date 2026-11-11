import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { openSync, type Font } from 'fontkit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  TabStopType,
  BorderStyle,
} from 'docx';
import PDFDocument from 'pdfkit';
import { TailoredCvDraft } from './tailored-cv.entity.js';
import { revision, uuid, version } from './tailored-cv.contract.js';
import {
  TailoredDraftError,
  type TailoredDraftDocument,
  type CvSectionKind,
} from './tailored-draft.contract.js';
import { approveReview } from './tailored-draft-review.policy.js';
import { professionalProfileHref } from './profile-links.js';

export const titles: Record<CvSectionKind, string> = {
  contact: 'Contact',
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  languages: 'Languages',
  links: 'Links',
  additional: 'Additional information',
};
export interface ExportDocument {
  templateVersion: '1';
  blocks: {
    text: string;
    style: 'title' | 'heading' | 'anchor' | 'body' | 'detail';
    entryStart: boolean;
    section?: CvSectionKind;
    /** Left label of a two-column row (skills category). */
    label?: string;
    /** Right-aligned companion of a title row (its dates). */
    aside?: string;
    /** Clickable target for a verified professional profile URL. */
    href?: string;
  }[];
}
export function canonicalExport(
  document: TailoredDraftDocument,
  savedRevision: number,
): ExportDocument {
  if (
    !document.review?.approval ||
    document.review.approval.revision !== savedRevision
  )
    throw new TailoredDraftError('CV_EXPORT_NOT_APPROVED');
  // Recheck the approval prerequisites rather than trusting an approval flag alone.
  const reviewedIds = Object.entries(document.review.factReviews)
    .filter(([, s]) => s.wording !== 'reviewed_profile')
    .map(([id]) => id);
  approveReview(
    document,
    reviewedIds,
    savedRevision,
    document.review.approval.approvedAt,
  );
  const blocks: ExportDocument['blocks'] = [];
  let count = 0;
  // Budgets count the saved text, not the reflowed layout.
  let sourceLines = 0;
  const order: CvSectionKind[] = [
    'contact',
    'summary',
    'skills',
    'experience',
    'projects',
    'education',
    'certifications',
    'languages',
    'links',
    'additional',
  ];
  // Verified profile links (LinkedIn, GitHub) render once, in the contact
  // header; every other link stays in Links. Text is emitted unchanged.
  const promoted = new Map<string, string>();
  for (const section of document.sections)
    if (section.kind === 'links')
      for (const fact of section.entries.flatMap((e) => e.facts)) {
        const href =
          fact.field === 'link'
            ? professionalProfileHref(fact.acceptedText)
            : null;
        if (
          href &&
          document.review.factReviews[fact.id]?.exportIncluded !== false
        )
          promoted.set(fact.id, href);
      }
  const sorted = [...document.sections].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  );
  const contactFacts = sorted.filter((s) => s.kind === 'contact');
  const promotedEntry = {
    id: 'promoted-profile-links',
    facts: sorted
      .filter((s) => s.kind === 'links')
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .filter((f) => promoted.has(f.id)),
  };
  const sections = [
    ...(contactFacts.length
      ? contactFacts.map((s, i) =>
          i === contactFacts.length - 1 && promotedEntry.facts.length
            ? { ...s, entries: [...s.entries, promotedEntry] }
            : s,
        )
      : promotedEntry.facts.length
        ? [
            {
              id: 'contact',
              kind: 'contact' as const,
              entries: [promotedEntry],
            },
          ]
        : []),
    ...sorted
      .filter((s) => s.kind !== 'contact')
      .map((s) =>
        s.kind === 'links'
          ? {
              ...s,
              entries: s.entries.map((e) => ({
                ...e,
                facts: e.facts.filter((f) => !promoted.has(f.id)),
              })),
            }
          : s,
      ),
  ];
  for (const section of sections) {
    const included = section.entries
      .flatMap((e) => e.facts)
      .filter(
        (f) => document.review!.factReviews[f.id]?.exportIncluded !== false,
      );
    if (!included.length) continue;
    if (section.kind !== 'contact')
      blocks.push({
        text: titles[section.kind],
        style: 'heading',
        entryStart: false,
      });
    for (const entry of section.entries) {
      const facts = entry.facts.filter((fact) => {
        const state = document.review!.factReviews[fact.id];
        if (!state) throw new TailoredDraftError('CV_EXPORT_NOT_APPROVED');
        if (state.exportIncluded === false) return false;
        if (
          !fact.acceptedText.trim() ||
          Array.from(fact.acceptedText).some((c) => {
            const n = c.charCodeAt(0);
            return (n < 32 && ![9, 10, 13].includes(n)) || n === 127;
          })
        )
          throw new TailoredDraftError('CV_EXPORT_UNSUPPORTED_TEXT');
        return true;
      });
      // Shared CV structure (mirrored by the web Final Preview): skills are
      // category + values rows; a title is paired with the dates after it.
      const rows = cvRows(section.kind, facts);
      let first = true;
      for (const row of rows) {
        const href = row.fact ? promoted.get(row.fact.id) : undefined;
        blocks.push({
          text: row.text,
          style:
            section.kind === 'contact' && row.field === 'name'
              ? 'title'
              : row.style,
          entryStart: first,
          section: section.kind,
          ...(row.label ? { label: row.label } : {}),
          ...(row.aside ? { aside: row.aside } : {}),
          ...(href ? { href } : {}),
        });
        first = false;
      }
      count += facts.length;
      sourceLines += facts.reduce(
        (n, fact) => n + fact.acceptedText.split('\n').length,
        0,
      );
    }
  }
  if (!count) throw new TailoredDraftError('CV_EXPORT_EMPTY');
  if (count > 96 || Buffer.byteLength(JSON.stringify(blocks)) > 96 * 1024)
    throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
  if (sourceLines > 1200)
    throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
  return { templateVersion: '1', blocks };
}
type ExportFact =
  TailoredDraftDocument['sections'][number]['entries'][number]['facts'][number];
// Bold title rows. A degree is ordinary text, as in a typical CV.
const TITLE_FIELDS = new Set(['employer', 'institution', 'role', 'title']);
// Only a real date range sits beside a title; "Graduated: 2019" stays a line.
const DATE_RANGE =
  /\d{4}\s*[-–—]\s*(?:\p{L}+\.?\s+)?(?:\d{4}|present|now|current)/iu;
const DETAIL_FIELDS = new Set(['project', 'skill', 'dates']);
/**
 * Layout-only reflow shared with the web preview: a line break inside a
 * sentence (PDF wrapping) becomes a space; breaks before a bullet, a new
 * item or after sentence-ending punctuation are kept. Words never change.
 */
export function reflow(text: string): string {
  return (
    text
      .replace(/\r\n?/gu, '\n')
      .trim()
      // Join only clear PDF wraps: after a comma, or lowercase word to lowercase
      // word. Lists like "City\nVietnam" or bullets keep their line breaks.
      .replace(/,[ \t]*\n[ \t]*(?![•\-–*·]|\d+[.)]\s)(?=\S)/gu, ', ')
      .replace(/(\p{Ll})[ \t]*\n[ \t]*(?=[\p{Ll}(])/gu, '$1 ')
      // A wrapped item inside a comma list: "Mentoring, Stakeholder\nCommunication".
      .replace(/(,[^\n]*\p{L})[ \t]*\n[ \t]*(?=\p{L})/gu, '$1 ')
  );
}
/** One entry rendered as rows; same rules as the web Final Preview. */
export function cvRows(kind: CvSectionKind, facts: ExportFact[]) {
  type Row = {
    text: string;
    style: 'anchor' | 'body' | 'detail';
    field: string;
    fact?: ExportFact;
    label?: string;
    aside?: string;
  };
  const rows: Row[] = [];
  const text = (fact: ExportFact) => reflow(fact.acceptedText);
  if (kind === 'skills') {
    const category = facts.filter((f) => f.field === 'skill_category');
    const values = facts.filter((f) => f.field !== 'skill_category');
    if (values.length)
      rows.push({
        text: values.map(text).join('\n'),
        style: 'body',
        field: 'skill',
        ...(category.length
          ? { label: category.map(text).join(' ').replace(/:\s*$/u, '') }
          : {}),
      });
    else
      for (const fact of category)
        rows.push({
          text: text(fact),
          style: 'anchor',
          field: fact.field,
          fact,
        });
    return rows;
  }
  const structured = ['experience', 'projects', 'education'].includes(kind);
  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i]!;
    const next = facts[i + 1];
    if (
      structured &&
      (TITLE_FIELDS.has(fact.field) ||
        // A project's name heads its entry like a role title.
        (kind === 'projects' && fact.field === 'project'))
    ) {
      const dates =
        next?.field === 'dates' && DATE_RANGE.test(next.acceptedText)
          ? next
          : undefined;
      if (dates) i++;
      rows.push({
        text: text(fact),
        style: 'anchor',
        field: fact.field,
        fact,
        ...(dates ? { aside: text(dates) } : {}),
      });
    } else
      rows.push({
        text: text(fact),
        style:
          structured && DETAIL_FIELDS.has(fact.field)
            ? 'detail'
            : kind === 'experience' && fact.field === 'headline'
              ? 'anchor'
              : 'body',
        field: fact.field,
        fact,
      });
  }
  // Education: a date range stored apart from the institution (e.g. after a
  // user split) belongs beside the institution line.
  const title = rows.find((row) => row.style === 'anchor');
  const range = rows.findIndex(
    (row) => row.field === 'dates' && DATE_RANGE.test(row.text),
  );
  if (kind === 'education' && title && !title.aside && range >= 0) {
    title.aside = rows[range]!.text;
    rows.splice(range, 1);
  }
  return rows;
}
// Nonbreaking whitespace is a layout choice only. Canonical/accepted text is
// untouched and both formats retain the same words and Unicode characters.
function layoutText(block: ExportDocument['blocks'][number]) {
  return block.section === 'skills'
    ? block.text.replace(/Stakeholder[ \t]+Communication/giu, (phrase) =>
        phrase.replace(/[ \t]+/u, '\u00a0'),
      )
    : block.text;
}
export async function renderDocx(content: ExportDocument): Promise<Buffer> {
  validateGlyphs(content);
  const CONTENT = 11906 - 2000; // page width minus margins (twips)
  const LABEL = 2560; // skills category column (twips)
  const paragraphs = content.blocks.map((block) => {
    const lines = layoutText(block).split('\n');
    const stacked = !!block.label && stackedLabel(block.label);
    // A stacked label is its own line, so the first value line breaks after it.
    const runs = lines.map((text, i) => run(block, text, stacked ? i + 1 : i));
    const children = [
      ...(block.label
        ? [
            new TextRun({
              text: block.label,
              bold: true,
              font: 'DejaVu Sans',
              size: 21,
            }),
            ...(stacked
              ? []
              : [new TextRun({ text: '\t', font: 'DejaVu Sans', size: 21 })]),
          ]
        : []),
      ...runs,
      ...(block.aside
        ? [
            new TextRun({
              text: `\t${block.aside}`,
              font: 'DejaVu Sans',
              size: 19,
              color: '4A5A55',
            }),
          ]
        : []),
    ];
    return new Paragraph({
      ...(block.style === 'heading'
        ? {
            heading: HeadingLevel.HEADING_1,
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 4,
                color: 'C9D3CF',
                space: 2,
              },
            },
          }
        : {}),
      ...(block.label && !stacked
        ? {
            tabStops: [{ type: TabStopType.LEFT, position: LABEL }],
            indent: { left: LABEL, hanging: LABEL },
          }
        : {}),
      ...(block.aside
        ? { tabStops: [{ type: TabStopType.RIGHT, position: CONTENT }] }
        : {}),
      keepNext: block.style === 'heading' || block.style === 'anchor',
      keepLines: block.style !== 'body',
      widowControl: true,
      spacing: {
        before: block.style === 'heading' ? 240 : block.entryStart ? 120 : 20,
        after: block.style === 'heading' ? 100 : 40,
      },
      children,
    });
  });
  function run(
    block: ExportDocument['blocks'][number],
    text: string,
    i: number,
  ) {
    const options = {
      text,
      break: i ? 1 : 0,
      font: 'DejaVu Sans',
      bold: block.style !== 'body' && block.style !== 'detail',
      size:
        block.style === 'title'
          ? 36
          : block.style === 'heading'
            ? 24
            : block.style === 'detail'
              ? 19
              : 21,
      ...(block.style === 'detail' ? { color: '4A5A55' } : {}),
    };
    return block.href
      ? new ExternalHyperlink({
          link: block.href,
          children: [new TextRun({ ...options, style: 'Hyperlink' })],
        })
      : new TextRun(options);
  }
  return Packer.toBuffer(
    new Document({
      creator: 'AI Job Hunter',
      title: 'Curriculum Vitae',
      description: 'Approved tailored CV',
      styles: {
        default: {
          document: {
            run: { font: 'DejaVu Sans', size: 21, color: '172B2A' },
            paragraph: { spacing: { line: 276 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 900, bottom: 900, left: 1000, right: 1000 },
            },
          },
          children: paragraphs,
        },
      ],
    }),
  );
}
const font = (name: string) => {
  const choices = [
    new URL(`../../assets/fonts/${name}.ttf`, import.meta.url),
    new URL(`../../../assets/fonts/${name}.ttf`, import.meta.url),
  ];
  const path = choices.find((url) => existsSync(url));
  if (!path) throw new Error('Bundled CV font unavailable');
  return fileURLToPath(path);
};
let regular: Font | undefined, bold: Font | undefined;
function validateGlyphs(content: ExportDocument) {
  regular ??= openSync(font('DejaVuSans')) as Font;
  bold ??= openSync(font('DejaVuSans-Bold')) as Font;
  const check = (text: string, face: Font) => {
    for (const char of text)
      if (!/\s/u.test(char) && !face.hasGlyphForCodePoint(char.codePointAt(0)!))
        throw new TailoredDraftError('CV_EXPORT_UNSUPPORTED_TEXT');
  };
  for (const block of content.blocks) {
    check(
      block.text,
      block.style === 'body' || block.style === 'detail' ? regular! : bold!,
    );
    if (block.label) check(block.label, bold!);
    if (block.aside) check(block.aside, regular!);
  }
}
// Skills category column, PDF points (DOCX uses the same width in twips).
const LABEL_PT = 128;
/**
 * A skills category that would wrap past two lines in the label column is
 * stacked above its values in both PDF and DOCX. Measured with the bundled
 * bold font so both formats make the same choice.
 */
export function stackedLabel(label: string) {
  bold ??= openSync(font('DejaVuSans-Bold')) as Font;
  const face = bold;
  const width = (text: string) =>
    (face.layout(text).advanceWidth / face.unitsPerEm) * 10.5;
  let lines = 1,
    line = '';
  for (const word of label.split(/\s+/u)) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > LABEL_PT - 12) {
      lines++;
      line = word;
    } else line = next;
  }
  return lines > 2;
}
export async function renderPdf(content: ExportDocument): Promise<Buffer> {
  validateGlyphs(content);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 45, bottom: 45, left: 50, right: 50 },
    bufferPages: true,
    info: { Title: 'Curriculum Vitae', Author: 'AI Job Hunter' },
  });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  try {
    let pages = 1;
    doc.on('pageAdded', () => {
      if (++pages > 40) throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
    });
    doc
      .registerFont('regular', font('DejaVuSans'))
      .registerFont('bold', font('DejaVuSans-Bold'));
    const left = doc.page.margins.left;
    const width = doc.page.width - 100;
    const ink = '#172B2A',
      muted = '#4A5A55';
    const opts = { lineGap: 2, paragraphGap: 0 };
    const set = (style: ExportDocument['blocks'][number]['style']) => {
      const size =
        style === 'title'
          ? 18
          : style === 'heading'
            ? 12
            : style === 'detail'
              ? 9.5
              : 10.5;
      doc
        .font(style === 'body' || style === 'detail' ? 'regular' : 'bold')
        .fontSize(size)
        .fillColor(style === 'detail' ? muted : ink);
    };
    const gap = (block: ExportDocument['blocks'][number]) =>
      block.style === 'heading' ? 12 : block.entryStart ? 6 : 1;
    // Measure each row exactly as it will be drawn.
    const measured = content.blocks.map((block) => {
      const text = layoutText(block);
      const stacked = !!block.label && stackedLabel(block.label);
      set(block.style);
      const line = doc.heightOfString('X', { width, ...opts });
      let asideWidth = 0;
      if (block.aside) {
        doc.font('regular').fontSize(9.5);
        asideWidth = Math.min(
          doc.widthOfString(block.aside) + 12,
          width * 0.45,
        );
        set(block.style);
      }
      const column = block.label && !stacked ? LABEL_PT : 0;
      const mainWidth = width - column - asideWidth;
      let height = doc.heightOfString(text, { width: mainWidth, ...opts });
      let labelHeight = 0;
      if (block.label) {
        doc.font('bold').fontSize(10.5);
        labelHeight = doc.heightOfString(block.label, {
          width: stacked ? width : LABEL_PT - 12,
          ...opts,
        });
        height = stacked ? labelHeight + height : Math.max(height, labelHeight);
        set(block.style);
      }
      return {
        text,
        stacked,
        line,
        asideWidth,
        column,
        mainWidth,
        height,
        labelHeight,
      };
    });
    const pageMax = doc.page.height - 100;
    const keeps = (block: ExportDocument['blocks'][number]) =>
      block.style === 'heading' || block.style === 'anchor';
    // Plain paragraphs may continue on the next page; other rows never split.
    const splittable = (i: number) =>
      content.blocks[i]!.style === 'body' && !content.blocks[i]!.label;
    const start = (i: number) =>
      splittable(i)
        ? Math.min(measured[i]!.height, measured[i]!.line * 2)
        : Math.min(measured[i]!.height, pageMax);
    for (const [index, block] of content.blocks.entries()) {
      const m = measured[index]!;
      // A heading stays with the headings after it and the first two lines
      // of the content they introduce, so no heading ends a page alone.
      let need = gap(block) + start(index);
      if (keeps(block))
        for (let j = index + 1; j < content.blocks.length; j++) {
          const next = content.blocks[j]!;
          need += gap(next) + start(j);
          if (!keeps(next)) break;
        }
      if (
        doc.y + Math.min(need, pageMax) >
          doc.page.height - doc.page.margins.bottom &&
        doc.y > doc.page.margins.top + 1
      )
        doc.addPage();
      doc.y += gap(block);
      set(block.style);
      const top = doc.y;
      const page = pages;
      let textTop = top;
      if (block.label) {
        doc.font('bold').fontSize(10.5).fillColor(ink);
        doc.text(block.label, left, top, {
          width: m.stacked ? width : LABEL_PT - 12,
          ...opts,
        });
        if (m.stacked) textTop = top + m.labelHeight;
        set(block.style);
      }
      doc.text(m.text, left + m.column, textTop, {
        width: m.mainWidth,
        ...opts,
        ...(block.href ? { link: block.href, underline: true } : {}),
      });
      const afterMain = doc.y;
      if (block.aside) {
        doc.font('regular').fontSize(9.5).fillColor(muted);
        doc.text(block.aside, left + width - m.asideWidth, top + 1, {
          width: m.asideWidth,
          align: 'right',
          ...opts,
        });
        set(block.style);
        doc.y = afterMain;
      }
      // A paragraph that continued on a new page already ends at doc.y.
      if (pages === page) doc.y = Math.max(doc.y, top + m.height);
      if (block.style === 'heading') {
        doc
          .moveTo(left, doc.y + 2)
          .lineTo(left + width, doc.y + 2)
          .lineWidth(0.6)
          .strokeColor('#C9D3CF')
          .stroke();
        doc.y += 6;
      } else doc.y += content.blocks[index + 1]?.entryStart ? 2 : 3;
      doc.x = left;
    }
    if (doc.bufferedPageRange().count > 40)
      throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
    doc.end();
    return await complete;
  } catch (error) {
    doc.destroy(new Error('Export aborted'));
    await complete.catch(() => undefined);
    throw error;
  }
}
@Injectable()
export class TailoredCvExportService {
  constructor(private readonly db: DataSource) {}
  async export(ownerId: string, id: string, body: unknown) {
    let expectedRevision: number, format: 'docx' | 'pdf';
    try {
      const request = version(body, ['expectedRevision', 'format']);
      expectedRevision = revision(request.expectedRevision);
      id = uuid(id);
      if (request.format !== 'docx' && request.format !== 'pdf')
        throw new Error();
      format = request.format;
    } catch {
      throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
    }
    const snapshot = await this.db.transaction(async (manager) => {
      const row = await manager.getRepository(TailoredCvDraft).findOne({
        where: { ownerId, id },
        select: { id: true, revision: true, document: true },
        lock: { mode: 'pessimistic_read' },
      });
      if (
        !row ||
        !('kind' in row.document) ||
        row.document.kind !== 'tailored_cv'
      )
        throw new TailoredDraftError('CV_DRAFT_NOT_FOUND');
      if (row.revision !== expectedRevision)
        throw new TailoredDraftError('CV_DRAFT_SAVE_CONFLICT');
      return canonicalExport(row.document, row.revision);
    });
    try {
      const buffer =
        format === 'pdf'
          ? await renderPdf(snapshot)
          : await renderDocx(snapshot);
      const current = await this.db.getRepository(TailoredCvDraft).findOne({
        where: { ownerId, id },
        select: { revision: true, document: true },
      });
      if (!current) throw new TailoredDraftError('CV_DRAFT_NOT_FOUND');
      if (current.revision !== expectedRevision)
        throw new TailoredDraftError('CV_DRAFT_SAVE_CONFLICT');
      if (
        !('kind' in current.document) ||
        current.document.review?.approval?.revision !== expectedRevision
      )
        throw new TailoredDraftError('CV_EXPORT_NOT_APPROVED');
      return {
        buffer,
        filename: `tailored-cv-${id.slice(0, 8)}-r${expectedRevision}.${format}`,
        mime:
          format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    } catch (error) {
      if (error instanceof TailoredDraftError) throw error;
      throw new TailoredDraftError('CV_EXPORT_UNAVAILABLE');
    }
  }
}
