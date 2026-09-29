import { Marked } from "marked";

/**
 * Markdown to HTML with every raw HTML token escaped.
 *
 * For model-written text (resumes): the model reads job postings, which it
 * does not control, so anything it echoes is untrusted. Markdown formatting
 * renders; a <script> or <img onerror> arrives as visible text instead.
 */
const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    },
  },
});

export function renderMarkdownSafe(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  // Links stay, but only to http(s)/mailto -- no javascript: URLs.
  return html.replace(/href="(?!https?:|mailto:)[^"]*"/gi, 'href="#"');
}
