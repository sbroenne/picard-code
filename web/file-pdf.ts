import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = worker;

export async function previewPdf(host: HTMLElement, bytes: ArrayBuffer, signal: AbortSignal) {
  if (signal.aborted) return () => {};
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    void loading.destroy();
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const pdf = await loading.promise;
    if (signal.aborted) { dispose(); return () => {}; }
    const label = document.createElement("p");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "Document page");
    const text = document.createElement("pre");
    const previous = document.createElement("button"), next = document.createElement("button");
    previous.type = next.type = "button";
    previous.textContent = "Previous page"; next.textContent = "Next page";
    let page = 1, revision = 0;
    const paint = async () => {
      const current = ++revision;
      previous.disabled = next.disabled = true;
      const item = await pdf.getPage(page);
      if (signal.aborted || current !== revision) return;
      const viewport = item.getViewport({ scale: 1.5 });
      if (viewport.width * viewport.height > 16_000_000) throw new Error("This PDF page is too large to preview.");
      canvas.width = viewport.width; canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not draw the document.");
      await item.render({ canvasContext: context, canvas, viewport }).promise;
      const content = await item.getTextContent();
      if (signal.aborted || current !== revision) return;
      text.textContent = content.items.map((item) => "str" in item ? item.str : "").join(" ");
      label.textContent = `Page ${page} of ${pdf.numPages}`;
      previous.disabled = page === 1; next.disabled = page === pdf.numPages;
    };
    const change = (step: number) => {
      page += step;
      void paint().catch((error: unknown) => { if (!signal.aborted) { label.textContent = String(error); label.setAttribute("role", "alert"); } });
    };
    previous.addEventListener("click", () => change(-1)); next.addEventListener("click", () => change(1));
    host.append(label, previous, next, canvas, text);
    await paint();
    return dispose;
  } catch (error) { dispose(); throw error; }
}
