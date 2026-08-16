/** Deterministic DOCX resume construction. @module @deepseek-ai/dsh-tool-docx/document */

import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'

/** One role, project, education item, or grouped skill entry. */
export interface ResumeEntry {
  /** Primary label, such as a role and employer or degree and school. */
  title: string
  /** Optional date, location, or secondary metadata line. */
  meta?: string
  /** Optional short explanatory paragraph. */
  description?: string
  /** Evidence bullets shown below the entry. */
  bullets?: string[]
}

/** One named resume section. */
export interface ResumeSection {
  /** Visible section heading. */
  heading: string
  /** Ordered entries in the section. */
  entries: ResumeEntry[]
}

/** Complete structured input for one generated resume. */
export interface ResumeDocument {
  /** Candidate name shown as the document title. */
  name: string
  /** Optional professional headline under the name. */
  headline?: string
  /** Contact facts shown on one centered line. */
  contact?: string[]
  /** Ordered resume sections. */
  sections: ResumeSection[]
}

const PAGE_DXA = { width: 12_240, height: 15_840 } as const
const PAGE_MARGIN_DXA = 936
const RESUME_FONTS = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft YaHei', cs: 'Arial' } as const
const COLORS = {
  ink: '202124',
  accent: '1F4E78',
  muted: '5F6368',
  rule: 'B8C6D1',
} as const

/**
 * Build one compact, single-column Word resume and return its OOXML archive.
 * @param resume - schema-validated resume content.
 * @returns the complete DOCX bytes.
 */
export async function buildResumeDocx(resume: ResumeDocument): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      keepNext: true,
      children: [new TextRun({ text: resume.name, font: RESUME_FONTS, bold: true, size: 48, color: COLORS.ink })],
    }),
  ]
  if (resume.headline !== undefined) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      keepNext: true,
      children: [new TextRun({ text: resume.headline, font: RESUME_FONTS, size: 22, color: COLORS.accent })],
    }))
  }
  if (resume.contact !== undefined && resume.contact.length > 0) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: resume.contact.join(' · '), font: RESUME_FONTS, size: 19, color: COLORS.muted })],
    }))
  }

  for (const section of resume.sections) {
    children.push(new Paragraph({
      style: 'ResumeSection',
      children: [new TextRun({ text: section.heading, font: RESUME_FONTS })],
    }))
    for (const entry of section.entries) {
      children.push(new Paragraph({
        spacing: { before: 40, after: entry.meta === undefined ? 50 : 20 },
        keepNext: entry.meta !== undefined || entry.description !== undefined || (entry.bullets?.length ?? 0) > 0,
        children: [new TextRun({ text: entry.title, font: RESUME_FONTS, bold: true, size: 21, color: COLORS.ink })],
      }))
      if (entry.meta !== undefined) {
        children.push(new Paragraph({
          spacing: { after: 40 },
          keepNext: entry.description !== undefined || (entry.bullets?.length ?? 0) > 0,
          children: [new TextRun({ text: entry.meta, font: RESUME_FONTS, italics: true, size: 19, color: COLORS.muted })],
        }))
      }
      if (entry.description !== undefined) {
        children.push(new Paragraph({
          spacing: { after: 60, line: 276, lineRule: 'auto' },
          children: [new TextRun({ text: entry.description, font: RESUME_FONTS })],
        }))
      }
      for (const bullet of entry.bullets ?? []) {
        children.push(new Paragraph({
          numbering: { reference: 'resume-bullets', level: 0 },
          spacing: { after: 30, line: 276, lineRule: 'auto' },
          children: [new TextRun({ text: bullet, font: RESUME_FONTS })],
        }))
      }
    }
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: RESUME_FONTS, size: 20, color: COLORS.ink },
          paragraph: { spacing: { after: 40, line: 276, lineRule: 'auto' } },
        },
      },
      paragraphStyles: [{
        id: 'ResumeSection',
        name: 'Resume Section',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { bold: true, size: 23, color: COLORS.accent },
        paragraph: {
          spacing: { before: 120, after: 60 },
          keepNext: true,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.rule, space: 2 } },
        },
      }],
    },
    numbering: {
      config: [{
        reference: 'resume-bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 270 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: PAGE_DXA,
          margin: {
            top: PAGE_MARGIN_DXA,
            right: PAGE_MARGIN_DXA,
            bottom: PAGE_MARGIN_DXA,
            left: PAGE_MARGIN_DXA,
            header: 480,
            footer: 480,
          },
        },
      },
      children,
    }],
  })
  return Packer.toBuffer(document)
}
