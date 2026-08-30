import DOMPurify from "dompurify";
import { marked } from "marked";

const allowedTags = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

marked.setOptions({ gfm: true, breaks: true });

export function renderSafeMarkdown(markdown: string): string {
  const parsed = marked.parse(markdown, { async: false });
  const safe = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ["href", "title"],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["style", "iframe", "object", "embed", "form", "input"],
  });
  const document = new DOMParser().parseFromString(safe, "text/html");
  for (const link of document.querySelectorAll("a")) {
    const href = link.getAttribute("href");
    if (!href) continue;
    try {
      const url = new URL(href, window.location.origin);
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
        link.removeAttribute("href");
        continue;
      }
      if (url.origin !== window.location.origin) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    } catch {
      link.removeAttribute("href");
    }
  }
  return document.body.innerHTML;
}
