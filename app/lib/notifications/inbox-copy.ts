// Knock's in-app template has a single body, but the inbox shows the
// headline and the detail line separately. Every in-app template in knock/
// therefore renders the shared partial twice: the headline, a blank line,
// then the detail line (knock-templates.test.ts enforces this). The inbox
// reads them back from the body block's `content` (the Markdown after
// Liquid), not its `rendered` HTML.

export type InboxCopy = { headline: string; detail: string };

/** Splits an inbox item's body into its headline and detail line. */
export function splitInboxBody(content: string): InboxCopy {
  const [headline = "", ...rest] = content
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n\s*\n/);

  return { headline: headline.trim(), detail: rest.join("\n\n").trim() };
}
