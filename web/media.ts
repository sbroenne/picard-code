import { replyMedia, type ReplyMedia } from "../src/shared/media";
import { errorMessage } from "../src/shared/messages";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const result = document.createElement(tag);
  if (text) result.textContent = text;
  return result;
}

/** Reuses matching page elements so unrelated live updates cannot reload a player. */
export function reconcile(parent: Node, wanted: Node) {
  const keyed = new Map<string, HTMLElement>();
  for (const child of parent.childNodes) if (child instanceof HTMLElement && child.dataset.keep) keyed.set(child.dataset.keep, child);
  let cursor = parent.firstChild;
  for (const next of Array.from(wanted.childNodes)) {
    const key = next instanceof HTMLElement ? next.dataset.keep : undefined;
    const current = key ? keyed.get(key)
      : cursor && cursor.nodeType === next.nodeType && cursor.nodeName === next.nodeName
        && !(cursor instanceof HTMLElement && cursor.dataset.keep) ? cursor : undefined;
    if (!current) { parent.insertBefore(next, cursor); continue; }
    if (current !== cursor) parent.insertBefore(current, cursor);
    if (current instanceof HTMLElement && next instanceof HTMLElement) {
      if (!current.classList.contains("reply-media") && !current.classList.contains("reply-output") && !current.classList.contains("reply-file") && !current.classList.contains("reply-code")) {
        for (const attr of Array.from(current.attributes)) if (attr.name !== "open" && !next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
        for (const attr of next.attributes) if (attr.name !== "open" && current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
        reconcile(current, next);
      }
    } else if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    cursor = current.nextSibling;
  }
  while (cursor) { const next = cursor.nextSibling; parent.removeChild(cursor); cursor = next; }
}

export function markMedia(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-media-href]").forEach((item, index) => {
    item.className = "reply-media";
    item.dataset.keep = `media:${index}:${item.dataset.mediaHref}`;
  });
}

export class ReplyPlayers {
  private players = new Map<HTMLElement, { stop(): void }>();
  private active?: HTMLElement;
  constructor(private hooks: { paused(value: boolean): void }) {}

  attach(element: HTMLElement, media: HTMLMediaElement) {
    const start = () => this.start(element), end = () => this.end(element);
    media.addEventListener("play", start);
    media.addEventListener("pause", end);
    media.addEventListener("ended", end);
    const player = { stop: () => { media.pause(); this.end(element); } };
    this.players.set(element, player);
    return () => {
      player.stop();
      media.removeEventListener("play", start);
      media.removeEventListener("pause", end);
      media.removeEventListener("ended", end);
      this.players.delete(element);
    };
  }

  stop() {
    for (const player of this.players.values()) player.stop();
    this.active = undefined;
    this.hooks.paused(false);
  }

  prune() {
    for (const [element, player] of this.players) {
      if (element.isConnected) continue;
      player.stop();
      this.players.delete(element);
      if (this.active === element) { this.active = undefined; this.hooks.paused(false); }
    }
  }

  private start(element: HTMLElement) {
    if (this.active === element) return;
    const previous = this.active;
    this.active = element;
    this.hooks.paused(true);
    if (previous) this.players.get(previous)?.stop();
  }
  private end(element: HTMLElement) {
    if (this.active !== element) return;
    this.active = undefined;
    this.hooks.paused(false);
  }

  mount(root: HTMLElement, project: string) {
    this.prune();
    for (const element of root.querySelectorAll<HTMLElement>(".reply-media")) {
      if (element.dataset.mounted) continue;
      const label = element.dataset.mediaLabel || element.textContent || "Media";
      element.dataset.mediaLabel = label;
      const reference = replyMedia(element.dataset.mediaHref ?? "", label, element.dataset.mediaImage === "true");
      if (reference?.local && element.closest<HTMLElement>("[data-media-ready]")?.dataset.mediaReady !== "true") {
        element.textContent = "Waiting for the completed reply before loading this file.";
        continue;
      }
      element.dataset.mounted = "true";
      element.replaceChildren();
      if (!reference) {
        element.append(node("span", `${label}: this media reference cannot be shown.`));
        continue;
      }
      const article = element.closest<HTMLElement>("[data-message-id]")!;
      const source = reference.local ? `/api/conversations/${encodeURIComponent(article.dataset.sessionId!)}/media/${encodeURIComponent(article.dataset.messageId!)}?${new URLSearchParams({ href: reference.href, project })}` : reference.href;
      const caption = node("span", label);
      caption.className = "media-caption";
      const link = node("a", "Open source");
      link.href = source;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const error = node("span");
      error.className = "media-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
      const fail = (message: string) => {
        error.textContent = message;
        error.hidden = false;
        this.end(element);
        if (reference.local) {
          void fetch(source, { signal: AbortSignal.timeout(10_000) }).then(async (response) => {
            if (response.ok) { await response.body?.cancel(); return; }
            const result: unknown = await response.json();
            if (result && typeof result === "object" && "error" in result && typeof result.error === "string") error.textContent = result.error;
            else error.textContent = `${message} The file check returned HTTP ${response.status}.`;
          }).catch((failure: unknown) => { error.textContent = `${message} Could not check the file. ${errorMessage(failure)}`; });
        }
      };
      element.append(caption);
      if (reference.kind === "embed") this.embed(element, reference, fail);
      else if (reference.kind === "image") {
        const image = node("img");
        image.alt = label;
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => { image.hidden = true; fail("This image could not be loaded. Open its source to check it."); });
        image.src = source;
        element.append(image);
      } else {
        const video = node("video");
        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;
        video.setAttribute("aria-label", label);
        video.addEventListener("play", () => this.start(element));
        video.addEventListener("pause", () => this.end(element));
        video.addEventListener("ended", () => this.end(element));
        video.addEventListener("error", () => fail("This video could not be played. Its format may not be supported, or its source may be unavailable."));
        video.src = source;
        element.append(video);
        this.players.set(element, { stop: () => { video.pause(); this.end(element); } });
      }
      element.append(link, error);
    }
  }

  private embed(element: HTMLElement, reference: ReplyMedia, fail: (message: string) => void) {
    const open = node("button", `Open player: ${reference.label}`);
    open.type = "button";
    open.className = "peach-button";
    const close = node("button", "Close player");
    close.type = "button";
    close.className = "peach-button";
    close.hidden = true;
    let frame: HTMLIFrameElement | undefined;
    const stop = () => {
      frame?.remove();
      frame = undefined;
      close.hidden = true;
      open.hidden = false;
      this.end(element);
    };
    open.addEventListener("click", () => {
      this.start(element);
      frame = node("iframe");
      frame.title = reference.label;
      // YouTube requires an HTTP referrer; send the origin only, never paths or the launch fragment.
      frame.referrerPolicy = reference.embed?.startsWith("https://www.youtube-nocookie.com/") ? "origin" : "no-referrer";
      frame.allow = "fullscreen";
      frame.sandbox.add("allow-scripts", "allow-same-origin", "allow-presentation");
      frame.src = reference.embed!;
      frame.addEventListener("error", () => { stop(); fail("This player could not be loaded. Open its source to check it."); });
      element.insertBefore(frame, open);
      open.hidden = true;
      close.hidden = false;
      close.focus();
    });
    close.addEventListener("click", () => { stop(); open.focus(); });
    const hint = node("span", "Listening pauses while this player is open. If the website refuses playback, open its source.");
    hint.className = "media-caption";
    element.append(open, close, hint);
    this.players.set(element, { stop });
  }
}
