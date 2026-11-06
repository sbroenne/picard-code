import { errorMessage } from "../src/shared/messages";
import type { ChatPart } from "../src/shared/types";
import { renderMarkdown } from "./markdown";
import DOMPurify from "dompurify";

const purify = DOMPurify(window);
const styles = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, styles];
const colors = new Map<string, string>();
let sequence = 0;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const result = document.createElement(tag);
  if (text) result.textContent = text;
  return result;
}

export function markOutputs(root: HTMLElement) {
  let index = 0;
  for (const code of root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")) {
    const pre = code.parentElement!;
    const source = code.textContent ?? "";
    const wrapper = node("div");
    wrapper.className = "reply-output";
    wrapper.dataset.keep = `diagram:${index++}:${source}:${pre.dataset.fenceComplete}`;
    wrapper.dataset.diagramSource = source;
    wrapper.dataset.fenceComplete = pre.dataset.fenceComplete;
    const details = node("details");
    details.append(node("summary", "View source"));
    pre.replaceWith(wrapper);
    details.append(pre);
    wrapper.append(node("p", "Waiting for the complete graph or diagram."), details);
  }
  for (const code of root.querySelectorAll<HTMLElement>("pre > code[class]")) {
    if (code.closest(".reply-output")) continue;
    const pre = code.parentElement!;
    pre.classList.add("reply-code");
    pre.dataset.keep = `code:${index++}:${code.className}:${code.textContent}:${pre.dataset.fenceComplete}`;
  }
}

/** Mounts only trusted rendering engines, never code supplied in a reply. */
export function mountOutputs(root: HTMLElement) {
  for (const wrapper of root.querySelectorAll<HTMLElement>(".reply-output")) {
    if (wrapper.dataset.mounted) continue;
    const complete = wrapper.dataset.fenceComplete !== "false" || wrapper.closest<HTMLElement>("[data-output-complete]")?.dataset.outputComplete === "true";
    if (!complete) continue;
    wrapper.dataset.mounted = "true";
    const status = wrapper.querySelector("p")!;
    status.textContent = "Preparing the graph or diagram.";
    void renderDiagram(wrapper, wrapper.dataset.diagramSource ?? "", status, wrapper.querySelector("details")!);
  }
  for (const code of root.querySelectorAll<HTMLElement>("pre > code")) {
    const pre = code.parentElement!;
    if (pre.closest(".reply-output") || pre.dataset.outputMounted) continue;
    const source = code.textContent ?? "";
    const language = /(?:^|\s)language-([\w+#.-]+)/.exec(code.className)?.[1]?.toLowerCase();
    if (!language) continue;
    const complete = pre.dataset.fenceComplete !== "false" || code.closest<HTMLElement>("[data-output-complete]")?.dataset.outputComplete === "true";
    if (!complete) continue;
    pre.dataset.outputMounted = "true";
    void highlight(code, source, language).catch((error: unknown) => {
      pre.append(node("p", `Code colouring is unavailable. ${errorMessage(error)}`));
    });
  }
}

async function renderDiagram(wrapper: HTMLElement, source: string, status: HTMLElement, details: HTMLDetailsElement) {
  try {
    const pele = await import("pele/lazy");
    if (!pele.detectType(source)) throw new Error("This diagram type is not supported.");
    const result = await pele.renderAsync(source, { idPrefix: `picard-diagram-${sequence++}-`, images: false,
      fontFamily: "sans-serif", fontSize: 16, linkRel: "noopener noreferrer" });
    const svg = purify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["foreignObject", "image", "a", "animate", "set"] });
    const image = node("img");
    image.alt = /^\s*title\s+["']?(.+?)["']?\s*$/m.exec(source)?.[1] ?? "Graph or diagram";
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    image.addEventListener("error", () => {
      image.remove();
      status.textContent = "The graph or diagram could not be displayed. Its source is below.";
      status.setAttribute("role", "alert");
      wrapper.prepend(status);
      details.open = true;
    });
    if (!wrapper.isConnected) return;
    status.replaceWith(image);
  } catch (error) {
    if (!wrapper.isConnected) return;
    status.textContent = `The graph or diagram could not be displayed. ${errorMessage(error)}`;
    status.setAttribute("role", "alert");
    details.open = true;
  }
}

async function highlight(code: HTMLElement, source: string, language: string) {
  const [{ codeToTokens, isSupportedLanguage }, { default: pierreDark }] = await Promise.all([
    import("@pierre/highlights"), import("@pierre/highlights/themes/pierre-dark"),
  ]);
  if (!isSupportedLanguage(language)) return;
  const fragment = document.createDocumentFragment();
  const { tokens } = codeToTokens(source, { lang: language, theme: pierreDark, tokenizeMaxLineLength: 10000 });
  tokens.forEach((line, index) => {
    if (index) fragment.append("\n");
    for (const token of line) {
      const span = node("span", token.content);
      const color = token.color;
      if (color && /^#[\da-f]{3,8}$/i.test(color)) {
        let name = colors.get(color);
        if (!name) {
          name = `code-color-${colors.size}`;
          colors.set(color, name);
          styles.insertRule(`.${name} { color: ${color}; }`);
        }
        span.className = `code-token ${name}`;
      }
      fragment.append(span);
    }
  });
  if (code.isConnected) code.replaceChildren(fragment);
}

export function workDetails(parts: ChatPart[]): HTMLDetailsElement | undefined {
  const work = parts.filter((part) => part.type === "tool" || part.type === "reasoning");
  if (!work.length) return undefined;
  const details = node("details");
  details.className = "work-details";
  details.dataset.keep = "work-details";
  details.append(node("summary", "Work details"));
  for (const part of work) {
    const item = node("section");
    item.dataset.keep = part.id;
    item.append(node("h3", part.type === "reasoning" ? "Reasoning" : part.tool?.name ?? part.text.split("\n")[0]));
    if (part.type === "reasoning") item.append(renderMarkdown(part.text));
    else {
      item.append(node("p", part.status === "completed" ? "Completed" : part.status === "running" ? "Accessing"
        : part.status === "pending" ? "Waiting" : part.status === "error" ? "Failed" : `Status: ${part.status ?? "not reported"}`));
      if (part.tool?.exit !== undefined) item.append(node("p", `Command exit code: ${part.tool.exit}`));
      if (part.tool?.input) {
        const pre = node("pre"); pre.append(node("code", part.tool.input)); item.append(pre);
      }
      const output = part.tool?.output ?? part.text;
      if (part.tool?.error) item.append(node("p", part.tool.error));
      if (output) {
        if (part.tool?.name === "shell" || part.tool?.name === "bash") {
          const pre = node("pre"); pre.append(node("code", output)); item.append(pre);
        } else item.append(renderMarkdown(output));
      }
      for (const change of part.tool?.changes ?? []) {
        const file = node("details");
        file.append(node("summary", change.file));
        if (change.patch !== undefined) {
          const pre = node("pre"); pre.append(node("code", change.patch)); file.append(pre);
        } else {
          for (const [label, text] of [["Before", change.before], ["After", change.after]] as const) {
            if (text === undefined) continue;
            file.append(node("h4", label));
            const pre = node("pre"); pre.append(node("code", text)); file.append(pre);
          }
        }
        item.append(file);
      }
    }
    details.append(item);
  }
  markOutputs(details);
  return details;
}
