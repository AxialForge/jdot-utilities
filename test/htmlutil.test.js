const test = require("node:test");
const assert = require("node:assert");
const h = require("../src/main/htmlutil");

test("stripNonContent removes <style> contents, not just the tags", () => {
  const out = h.stripNonContent('<style>.a{color:#c00;font-weight:700}</style><p>body</p>');
  assert.ok(!out.includes("font-weight"), "CSS declaration survived");
  assert.ok(!out.includes(".a{"), "CSS selector survived");
  assert.ok(out.includes("<p>body</p>"));
});

test("stripNonContent removes <script> contents", () => {
  const out = h.stripNonContent('<script>window.track=function(){alert(1)}</script><p>hi</p>');
  assert.ok(!out.includes("window.track"));
  assert.ok(!out.includes("alert"));
  assert.ok(out.includes("<p>hi</p>"));
});

test("stripNonContent handles attributes, whitespace and case on the tags", () => {
  const variants = [
    '<SCRIPT TYPE="text/javascript">bad()</SCRIPT>',
    '<script  src="x.js" defer >bad()</script >',
    '<style media="print">bad{}</style>',
    "<  script >bad()</  script  >",
  ];
  for (const v of variants) {
    const out = h.stripNonContent(v + "<p>ok</p>");
    assert.ok(!/bad/.test(out), `leaked from: ${v} -> ${out}`);
    assert.ok(out.includes("<p>ok</p>"));
  }
});

test("stripNonContent drops an unclosed trailing <script> (truncated file)", () => {
  const out = h.stripNonContent("<p>ok</p><script>never closed...");
  assert.ok(!out.includes("never closed"));
  assert.ok(out.includes("<p>ok</p>"));
});

test("stripNonContent removes comments and <title>", () => {
  const out = h.stripNonContent("<!-- secret note --><title>Page Title</title><p>ok</p>");
  assert.ok(!out.includes("secret note"));
  assert.ok(!out.includes("Page Title"));
});

test("stripNonContent leaves an inline style *attribute* alone", () => {
  const out = h.stripNonContent('<p style="color:red">keep me</p>');
  assert.ok(out.includes('style="color:red"'), "attribute was wrongly stripped");
  assert.ok(out.includes("keep me"));
});

test("extractTitle reads the title before it is stripped", () => {
  assert.strictEqual(h.extractTitle("<title> Q3 Report </title><p>x</p>"), "Q3 Report");
  assert.strictEqual(h.extractTitle("<p>no title here</p>"), null);
});

test("baseHrefFor produces a slash-terminated file:// URL and encodes spaces", () => {
  const url = h.baseHrefFor(process.platform === "win32" ? "C:\\Users\\Jo Doe\\docs" : "/home/jo doe/docs");
  assert.ok(url.startsWith("file:///"), url);
  assert.ok(url.endsWith("/"), url);
  assert.ok(!url.includes(" "), "space must be percent-encoded: " + url);
  assert.ok(url.includes("%20"), url);
});

test("wrapDocument injects the base href so relative assets resolve", () => {
  const doc = h.wrapDocument('<img src="chart.png">', {
    baseDir: process.platform === "win32" ? "C:\\tmp\\src" : "/tmp/src",
  });
  assert.match(doc, /<base href="file:\/\/\/[^"]+\/">/);
  assert.ok(doc.includes('<img src="chart.png">'));
});

test("wrapDocument escapes the title it is given", () => {
  const doc = h.wrapDocument("<p>x</p>", { title: '<script>x</script>&"' });
  assert.ok(!doc.includes("<script>x</script>"));
  assert.ok(doc.includes("&lt;script&gt;"));
});

test("toPlainText decodes entities and collapses blank runs", () => {
  const txt = h.toPlainText("<p>a &amp; b</p><p>&nbsp;</p><p>c&mdash;d &#39;e&#39;</p>");
  assert.ok(txt.includes("a & b"));
  assert.ok(txt.includes("c—d 'e'"));
  assert.ok(!/\n{3,}/.test(txt), "blank-line run not collapsed");
});

test("toPlainText turns block ends into newlines and cells into tabs", () => {
  const txt = h.toPlainText("<h1>Title</h1><p>one</p><table><tr><td>a</td><td>b</td></tr></table>");
  assert.ok(txt.startsWith("Title"));
  assert.ok(txt.includes("one"));
  assert.ok(txt.includes("a\tb"));
});

test("decodeEntities leaves unknown entities intact rather than mangling them", () => {
  assert.strictEqual(h.decodeEntities("&notanentity; &amp;"), "&notanentity; &");
});
