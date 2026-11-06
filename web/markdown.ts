import { Marked } from "marked";
import DOMPurify from "dompurify";
import { replyMedia } from "../src/shared/media";
import { replyFile } from "../src/shared/files";
import katex from "katex";
import type { Tokens } from "marked";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Model HTML stays text. Media placeholders are validated before any resource is loaded.
const reader = new Marked({ gfm: true, async: false });
reader.use({
  renderer: {
    html: ({ text }) => escape(text),
    image: ({ href, text }) => replyFile(href) && !replyMedia(href, text, true)
      ? `<span data-file-href="${escape(href)}">${escape(text || "Image")}</span>`
      : `<span data-media-href="${escape(href)}" data-media-image="true">${escape(text || "Image")}</span>`,
    link({ href, text }) {
      return replyMedia(href, text)
        ? `<span data-media-href="${escape(href)}">${escape(text || "Media")}</span>`
        : replyFile(href) ? `<span data-file-href="${escape(href)}">${escape(text || "File")}</span>`
        : false;
    },
    code({ text, lang, raw }: Tokens.Code) {
      const language = lang?.split(/\s/)[0]?.replace(/[^\w+#.-]/g, "") ?? "";
      const closed = /(?:^|\n)[ \t]*(?:`{3,}|~{3,})[ \t]*\n?$/.test(raw);
      return `<pre data-fence-complete="${closed}"><code class="language-${language}">${escape(text)}</code></pre>`;
    },
  },
  extensions: [{
    name: "math", level: "inline", start: (source: string) => source.search(/\$|\\\(/),
    tokenizer(source: string) {
      const match = /^(?:\$\$([^$\n]+)\$\$|\$(?=\S)([^$\n]*?\S)\$(?!\w)|\\\(([^ \n][\s\S]*?)\\\))/.exec(source);
      if (match) return { type: "math", raw: match[0], text: match[1] ?? match[2] ?? match[3]!, display: !!match[1] };
    },
    renderer(token) { return katex.renderToString(token.text, { output: "mathml", displayMode: token.display === true, throwOnError: false, trust: false }); },
  }, {
    name: "displayMath", level: "block",
    tokenizer(source: string) {
      const match = /^(?:\$\$\s*\n([\s\S]*?)\n\$\$|\\\[\s*\n([\s\S]*?)\n\\\])(?:\n|$)/.exec(source);
      if (match) return { type: "displayMath", raw: match[0], text: match[1] ?? match[2]! };
    },
    renderer(token) { return katex.renderToString(token.text, { output: "mathml", displayMode: true, throwOnError: false, trust: false }); },
  }],
});

const purify = DOMPurify(window);
purify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const ALLOWED_TAGS = ["p", "br", "strong", "em", "del", "code", "pre", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "input", "span",
  "math", "semantics", "annotation", "mrow", "mi", "mn", "mo", "mtext", "mspace", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot",
  "mover", "munder", "munderover", "mtable", "mtr", "mtd", "mstyle", "mpadded", "menclose", "mmultiscripts", "mprescripts", "none"];
const MATH_ATTRIBUTES = ["display", "encoding", "mathvariant", "stretchy", "fence", "separator", "accent", "accentunder",
  "columnalign", "rowspacing", "columnspacing", "linethickness"];

/** Turns a Markdown reply into safe page elements. Model output is never trusted as HTML. */
export function renderMarkdown(text: string): DocumentFragment {
  const html = reader.parse(text) as string;
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "class", "start", "type", "checked", "disabled", "align", "xmlns", ...MATH_ATTRIBUTES],
    ADD_URI_SAFE_ATTR: MATH_ATTRIBUTES,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    RETURN_DOM_FRAGMENT: true,
  });
}
