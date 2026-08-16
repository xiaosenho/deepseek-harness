/** Deterministic Markdown resume construction. @module @deepseek-ai/dsh-tool-docx/document */

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

/**
 * Build one deterministic Markdown resume.
 * @param resume - schema-validated resume content.
 * @returns the complete Markdown document.
 */
export function buildResumeMarkdown(resume: ResumeDocument): string {
  const lines: string[] = []
  lines.push(`# ${resume.name}`)
  if (resume.headline !== undefined) lines.push(`*\*\*${resume.headline}\*\*\**`)
  if (resume.contact !== undefined && resume.contact.length > 0) lines.push(resume.contact.join(' · '))
  lines.push('')
  for (const section of resume.sections) {
    lines.push(`## ${section.heading}`, '')
    for (const entry of section.entries) {
      lines.push(`### ${entry.title}`)
      if (entry.meta !== undefined) lines.push(`*\*\*${entry.meta}\*\*\**`)
      if (entry.description !== undefined) lines.push(entry.description)
      for (const bullet of entry.bullets ?? []) lines.push(`- ${bullet}`)
      lines.push('')
    }
  }
  return lines.join('\n').trimEnd() + '\n'
}
