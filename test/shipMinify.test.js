// What the build strips from the SHIPPED bytes must never change what runs.
//
// The served bundles lose their leading indentation (stripIndentation) and the
// served stylesheet is minified (minifyCss). Both are hand-rolled on purpose (no
// bundler, no native dependency), so both are held here to "no semantic change":
// the JavaScript by AST equality over every real client module, the CSS by the
// cases where whitespace, strings and comments are load-bearing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLES, stripIndentation } from "../scripts/build-client.mjs";
import { minifyCss, renderStyles } from "../scripts/build-styles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const printer = ts.createPrinter({ removeComments: true });
const printed = (name, text) =>
  printer.printFile(ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, false, ts.ScriptKind.JS));

test("stripping indentation leaves every client module's program identical", () => {
  const inputs = BUNDLES.flatMap((b) => b.inputs);
  assert.ok(inputs.length > 100);
  for (const input of inputs) {
    const source = readFileSync(path.join(root, input), "utf8");
    const stripped = stripIndentation(source, input);
    assert.equal(printed(input, stripped), printed(input, source), `${input} parses to the same program`);
  }
});

test("indentation inside template and string literals is kept byte-for-byte", () => {
  const source = [
    "function card() {",
    "    const html = `<div>",
    "        <pre>  keep   me  </pre>",
    "    </div>`;",
    "    const nested = `${a ? `",
    "      inner",
    "    ` : \"\"}`;",
    '    const s = "a\\',
    '    b";',
    "    return html;",
    "}",
  ].join("\n");
  const out = stripIndentation(source);
  assert.match(out, /^const html = `<div>\n {8}<pre> {2}keep {3}me {2}<\/pre>\n {4}<\/div>`;$/m);
  assert.match(out, /\n {6}inner\n {4}` : ""\}`;/);
  assert.match(out, /"a\\\n {4}b";/);
  assert.match(out, /^return html;$/m, "code lines lose their indentation");
  assert.equal(printed("x.js", out), printed("x.js", source));
});

test("the served bundles are the stripped modules", () => {
  const bundle = BUNDLES.find((b) => b.output.endsWith("bundle-01-core.js"));
  const served = readFileSync(path.join(root, bundle.output), "utf8");
  for (const input of bundle.inputs) {
    const stripped = stripIndentation(readFileSync(path.join(root, input), "utf8"), input).trimEnd();
    assert.ok(served.includes(stripped), `${input} ships stripped`);
  }
});

test("CSS minification keeps every load-bearing space, string and url", () => {
  const css = [
    "/* a comment with { braces } and ; semicolons */",
    ".a  .b > .c , .d:hover {",
    "  width: calc( 100% - var(--gap , 8px) );",
    "  font-family: \"Young Serif\" , serif ;",
    "  content: \"a  /* not a comment */  b\";",
    "  background: url(data:image/svg+xml;utf8,<svg a='1'/>) no-repeat, url( \"/x.png\" );",
    "  --list:  a , b ;",
    "  --empty-ish: 1px ;",
    "}",
    "@media (min-width: 700px) and (prefers-color-scheme: dark) {",
    "  :root:not([data-theme=\"light\"]) .x :is(.y, .z) { color: red ; }",
    "}",
    ".e/**/.f { margin: 0 auto; border: 1px/* w */solid red }",
  ].join("\n");
  const out = minifyCss(css);
  assert.doesNotMatch(out, /with \{ braces \}/, "comments go");
  assert.match(out, /\.a \.b > \.c,\.d:hover\{/, "the descendant combinator keeps one space");
  assert.match(out, /width: calc\( 100% - var\(--gap,8px\) \)/, "calc keeps the spaces around its operators");
  assert.match(out, /font-family: "Young Serif",serif/);
  assert.match(out, /content: "a {2}\/\* not a comment \*\/ {2}b"/, "strings are verbatim");
  assert.match(out, /url\(data:image\/svg\+xml;utf8,<svg a='1'\/>\) no-repeat,url\( "\/x\.png" \)/, "url bodies are verbatim");
  assert.match(out, /--list: a , b;/, "a custom property keeps its value's comma spacing");
  assert.match(out, /@media \(min-width: 700px\) and \(prefers-color-scheme: dark\)\{/);
  assert.match(out, /:root:not\(\[data-theme="light"\]\) \.x :is\(\.y,\.z\)\{color: red\}/);
  // A comment is not whitespace: glued between two tokens it survives as `/**/`.
  assert.match(out, /\.e\/\*\*\/\.f\{margin: 0 auto;border: 1px\/\*\*\/solid red\}/);
  assert.equal(out.split("\n").filter(Boolean).length, 4, "one rule per line");
});

test("the committed stylesheet is the minified partials", () => {
  const committed = readFileSync(path.join(root, "public/styles.css"), "utf8");
  assert.equal(committed, renderStyles());
  assert.ok(committed.length < 470_000, "comments and indentation are not shipped");
});
