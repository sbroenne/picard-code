import { Marked } from "marked";
import DOMPurify from "dompurify";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// OpenCode replies in GitHub-style Markdown. Raw HTML in a reply is shown as text, and pictures
// become links, so a reply cannot load anything from the internet by itself.
const reader = new Marked({ gfm: true, async: false });
reader.use({
  renderer: {
    html: ({ text }) => escape(text),
    image: ({ href, text }) => `<a href="${escape(href)}">${escape(text || href)}</a>`,
  },
});

const purify = DOMPurify(window);
purify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const ALLOWED_TAGS = ["p", "br", "strong", "em", "del", "code", "pre", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "input"];

/** Turns a Markdown reply into safe page elements. Model output is never trusted as HTML. */
export function renderMarkdown(text: string): DocumentFragment {
  const html = reader.parse(text) as string;
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "class", "start", "type", "checked", "disabled", "align"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    RETURN_DOM_FRAGMENT: true,
  });
}
