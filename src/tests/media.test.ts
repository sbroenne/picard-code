import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaReferences, replyMedia } from "../shared/media.js";
import { chatMessages } from "../server/history.js";
import { spokenSummary } from "../shared/speech.js";

test("reply media accepts supported Project paths and public HTTPS sources", () => {
  for (const href of ["image.png", "images/my picture.jpg", "/project/a.webp", "C:\\project\\a.gif", "file:///C:/project/a.png"]) {
    assert.equal(replyMedia(href)?.local, true, href);
  }
  assert.equal(replyMedia("https://media.example.com/image?id=1", "Diagram", true)?.kind, "image");
  assert.equal(replyMedia("https://media.example.com/demo.mp4?v=2")?.kind, "video");
  assert.equal(replyMedia("https://media.example.com/demo.webm")?.kind, "video");
  assert.equal(replyMedia("https://youtu.be/abcdefghijk")?.embed, "https://www.youtube-nocookie.com/embed/abcdefghijk");
  assert.equal(replyMedia("https://www.youtube.com/watch?v=abcdefghijk&t=2")?.kind, "embed");
  assert.equal(replyMedia("https://vimeo.com/123456")?.embed, "https://player.vimeo.com/video/123456");
  assert.equal(replyMedia("https://example.com/a.html"), undefined);
});

test("unsafe URLs and unsupported local files cannot become players", () => {
  for (const href of [
    "https://127.0.0.1/a.png", "https://2130706433/a.png", "https://0x7f000001/a.png",
    "https://[::1]/a.png", "https://host.local/a.png", "https://localhost/a.png",
    "https://localhost./private.png", "https://device.local./private.png", "https://host.internal./private.png",
    "https://host.lan./private.png", "https://host.home./private.png",
    "https://user:password@example.com/a.png", "https://example.com:8080/a.mp4",
    "http://example.com/a.png", "//example.com/a.png", "\\\\server\\a.png",
    "data:image/png;base64,abc", "javascript:alert(1)", "../a.png", "%2e%2e/a.png", "a%00.png",
    "a.svg", "page.html", ".env", "a.constructor", "https://example.com/a.constructor", "https://example.com/a.png\n",
  ]) assert.equal(replyMedia(href), undefined, href);
  for (const href of ["https://youtube.com.evil.example/watch?v=abcdefghijk", "https://vimeo.com/123/evil", "https://youtube.com/watch?v=bad"]) {
    assert.equal(replyMedia(href), undefined, href);
  }
});

test("only actual Markdown media references authorize local files", () => {
  assert.deepEqual(mediaReferences('![Diagram](<images/my picture.png>)\n\n[Demo](demo.webm)\n\n`![Hidden](secret.png)`\n\n```\n[x](private.png)\n```')
    .map((item) => item.href), ["images/my picture.png", "demo.webm"]);
  assert.deepEqual(mediaReferences("![nested](a.png) [![cover](cover.jpg)](https://vimeo.com/123)"), [
    replyMedia("a.png", "nested", true), replyMedia("https://vimeo.com/123", "![cover](cover.jpg)"), replyMedia("cover.jpg", "cover", true),
  ]);
});

test("completed OpenCode 2 tool files survive history without exposing private tool details", () => {
  const history = chatMessages([{
    id: "reply", type: "assistant", time: { created: 1 }, content: [{
      type: "tool", id: "generate", name: "test-image", state: { status: "completed", content: [
        { type: "text", text: "Tool detail" },
        { type: "file", uri: "image.png", mime: "image/png", name: "Result" },
      ] },
    }],
  }]);
  assert.equal(history[0]?.parts[1]?.type, "media");
  assert.equal(history[0]?.parts[1]?.href, "image.png");
  assert.equal(history[0]?.parts[0]?.text, "test-image\nTool detail");
  assert.equal(spokenSummary("![The diagram](diagram.png)"), "The diagram");
});
