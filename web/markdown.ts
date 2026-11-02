import { Marked } from "marked";
import DOMPurify from "dompurify";
import { replyMedia } from "../src/shared/media";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Model HTML stays text. Media placeholders are validated before any resource is loaded.
const reader = new Marked({ gfm: true, async: false });
reader.use({
  renderer: {
    html: ({ text }) => escape(text),
    image: ({ href, text }) => `<span data-media-href="${escape(href)}" data-media-image="true">${escape(text || "Image")}</span>`,
    link({ href, text }) {
      return replyMedia(href, text)
        ? `<span data-media-href="${escape(href)}">${escape(text || "Media")}</span>`
        : false;
    },
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
  "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "input", "span"];

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
