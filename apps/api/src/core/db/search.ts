/**
 * Prisma's `contains` becomes SQL `LIKE '%…%'` without escaping, so `%` and `_` typed into a
 * search box act as wildcards (`%` matched every user). This escapes them, and the escape
 * character itself, so the text is matched literally. PostgreSQL's default LIKE escape is `\`.
 */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
