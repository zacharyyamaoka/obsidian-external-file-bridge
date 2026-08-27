import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = name => `data:image/png;base64,${readFileSync(resolve(root, 'docs/evidence', name)).toString('base64')}`;

const screenshots = {
	source: image('source-monaco.png'),
	watcher: image('watcher-refreshed-monaco.png'),
	html: image('rendered-html.png'),
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>External File Bridge · implementation gallery</title>
<style>
:root { color-scheme: dark; --bg:#090b10; --panel:#11151d; --panel2:#171d28; --text:#f4f6fa; --muted:#9da8bb; --line:#293244; --blue:#74a7ff; --cyan:#65d9e8; --green:#6fe0a6; --amber:#ffc56e; }
* { box-sizing:border-box; }
body { margin:0; background:radial-gradient(circle at 15% -10%,#243354 0,transparent 30%),var(--bg); color:var(--text); font:15px/1.55 Inter,ui-sans-serif,system-ui,sans-serif; }
main { width:min(1180px,calc(100% - 32px)); margin:auto; padding:56px 0 72px; }
.eyebrow { color:var(--cyan); text-transform:uppercase; letter-spacing:.14em; font-size:12px; font-weight:800; }
h1 { max-width:900px; margin:10px 0 16px; font-size:clamp(38px,7vw,76px); line-height:.98; letter-spacing:-.055em; }
.lede { max-width:770px; color:#c0c8d5; font-size:19px; }
.badges { display:flex; flex-wrap:wrap; gap:9px; margin:28px 0 50px; }
.badge { border:1px solid var(--line); background:#111722cc; border-radius:999px; padding:8px 12px; color:#d9dfeb; }
.badge strong { color:var(--green); }
section { margin-top:54px; }
h2 { margin:0 0 18px; font-size:26px; letter-spacing:-.025em; }
.flow { display:grid; grid-template-columns:repeat(5,1fr); align-items:stretch; gap:12px; }
.node { position:relative; min-height:132px; padding:18px; border:1px solid var(--line); border-radius:16px; background:linear-gradient(145deg,var(--panel2),var(--panel)); }
.node:not(:last-child)::after { content:'→'; position:absolute; right:-19px; top:47px; z-index:2; color:var(--blue); font-size:23px; font-weight:800; }
.node .n { display:block; color:var(--blue); font:700 12px/1.2 ui-monospace,monospace; margin-bottom:14px; }
.node strong { display:block; font-size:16px; margin-bottom:6px; }
.node p { margin:0; color:var(--muted); font-size:13px; }
.tabs { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
button { border:1px solid var(--line); border-radius:10px; background:var(--panel); color:#c4ccda; padding:10px 14px; cursor:pointer; font:inherit; }
button[aria-selected="true"] { color:#071015; background:var(--cyan); border-color:var(--cyan); font-weight:750; }
.proof { overflow:hidden; border:1px solid var(--line); border-radius:18px; background:var(--panel); box-shadow:0 24px 70px #0008; }
.proof img { display:block; width:100%; aspect-ratio:1.6; object-fit:cover; object-position:top left; background:#07090d; }
.caption { display:grid; grid-template-columns:1fr auto; gap:18px; align-items:center; padding:18px 20px; border-top:1px solid var(--line); }
.caption strong { display:block; margin-bottom:4px; }
.caption span { color:var(--muted); }
.pass { color:var(--green)!important; font-weight:800; white-space:nowrap; }
.grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
.card { border:1px solid var(--line); border-radius:16px; background:linear-gradient(145deg,#151b26,#0e1219); padding:20px; }
.card .icon { font-size:23px; }
.card h3 { margin:10px 0 6px; }
.card p { color:var(--muted); margin:0; }
table { width:100%; border-collapse:collapse; overflow:hidden; border-radius:14px; background:var(--panel); }
th,td { padding:13px 15px; text-align:left; border-bottom:1px solid var(--line); }
th { color:#aeb8c8; font-size:12px; letter-spacing:.08em; text-transform:uppercase; }
td:last-child { color:var(--green); font-weight:700; }
code { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; color:#b8d0ff; }
footer { margin-top:52px; padding-top:18px; border-top:1px solid var(--line); color:#7f8a9c; }
@media (max-width:850px) { .flow,.grid { grid-template-columns:1fr; } .node:not(:last-child)::after { content:'↓'; right:auto; left:50%; top:auto; bottom:-22px; } .caption { grid-template-columns:1fr; } }
</style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">External File Bridge · 0.1.0</div>
    <h1>External on disk.<br>Native inside Obsidian.</h1>
    <p class="lede">One requested path becomes a temporary read-only <code>TFile</code>. Monaco and the core Web Viewer remain independent renderers; the vault never receives a copy.</p>
    <div class="badges">
      <span class="badge"><strong>141</strong> tests passing</span>
      <span class="badge"><strong>0</strong> production audit findings</span>
      <span class="badge">Obsidian <strong>1.13.7</strong></span>
      <span class="badge">VSCode Editor <strong>1.0.5</strong></span>
      <span class="badge"><strong>read-only</strong> first</span>
    </div>
  </header>

  <section id="architecture">
    <h2>The runtime composition</h2>
    <div class="flow">
      <div class="node"><span class="n">01 · ADDRESS</span><strong>Mount-aware link</strong><p>A stable mount ID plus a relative path replaces machine-bound absolute links.</p></div>
      <div class="node"><span class="n">02 · GUARD</span><strong>Canonical resolver</strong><p>Realpath containment rejects traversal and symlink escapes before injection.</p></div>
      <div class="node"><span class="n">03 · BRIDGE</span><strong>Session-only TFile</strong><p>Only the requested file and synthetic parent chain enter Obsidian's in-memory tree.</p></div>
      <div class="node"><span class="n">04 · RENDER</span><strong>Existing view owner</strong><p>VSCode Editor owns Monaco. Core Web Viewer owns rendered HTML.</p></div>
      <div class="node"><span class="n">05 · REFRESH</span><strong>Per-file watcher</strong><p>A public vault modify event refreshes an open Monaco buffer after disk changes.</p></div>
    </div>
  </section>

  <section id="proof">
    <h2>Real-app proof</h2>
    <div class="tabs" role="tablist">
      <button data-proof="source" aria-selected="true">Source handoff</button>
      <button data-proof="watcher" aria-selected="false">Live refresh</button>
      <button data-proof="html" aria-selected="false">Rendered HTML</button>
    </div>
    <figure class="proof">
      <img id="proof-image" src="${screenshots.source}" alt="External Python file open in Monaco inside isolated Obsidian">
      <figcaption class="caption"><div><strong id="proof-title">A clicked Python link opens in Monaco</strong><span id="proof-copy">The active view is <code>vscode-editor</code>, line 2 is selected, and Monaco reports read-only mode.</span></div><span class="pass">✓ isolated Obsidian</span></figcaption>
    </figure>
  </section>

  <section>
    <h2>The safety boundary</h2>
    <div class="grid">
      <article class="card"><div class="icon">◌</div><h3>No vault import</h3><p>The <code>_External</code> tree exists only as Obsidian objects. The physical vault path was asserted absent during the UI test.</p></article>
      <article class="card"><div class="icon">⌁</div><h3>No repository scan</h3><p>The adapter lists only session entries already requested by a link. Opening one file never enumerates its parent project.</p></article>
      <article class="card"><div class="icon">◇</div><h3>No renderer capture</h3><p>The bridge owns access, not presentation. HTML source and rendered intent are explicit, so ecosystem plugins stay composable.</p></article>
    </div>
  </section>

  <section>
    <h2>Verification ledger</h2>
    <table>
      <thead><tr><th>Claim</th><th>Evidence</th><th>Result</th></tr></thead>
      <tbody>
        <tr><td>Resolver and session behavior</td><td>Vitest, including traversal and symlink escape cases</td><td>141 / 141</td></tr>
        <tr><td>Production dependency surface</td><td><code>npm audit --omit=dev</code></td><td>0 findings</td></tr>
        <tr><td>Source rendering</td><td>Clicked protocol link → <code>vscode-editor</code> → Monaco</td><td>Pass</td></tr>
        <tr><td>Read-only boundary</td><td>Monaco raw option + adapter namespace guard</td><td>Pass</td></tr>
        <tr><td>External refresh</td><td>Disk rewrite observed in the already-open Monaco buffer</td><td>Pass</td></tr>
        <tr><td>Rendered HTML</td><td>Clicked rendered link → core <code>webviewer</code> + fragment</td><td>Pass</td></tr>
        <tr><td>Live installation</td><td>Both plugins loaded; Python Viewer disabled; captured error buffer empty</td><td>Pass</td></tr>
      </tbody>
    </table>
  </section>

  <footer>Forked from Folder Bridge 2.15.3 · local-only runtime · screenshots captured on an invisible throwaway vault · 2026-08-26</footer>
</main>
<script>
const proofs = {
  source: { src: ${JSON.stringify(screenshots.source)}, alt:'External Python file open in Monaco inside isolated Obsidian', title:'A clicked Python link opens in Monaco', copy:'The active view is <code>vscode-editor</code>, line 2 is selected, and Monaco reports read-only mode.' },
  watcher: { src: ${JSON.stringify(screenshots.watcher)}, alt:'Monaco refreshed after the original external Python file changed', title:'The open buffer follows the real file', copy:'Chokidar watches only the exposed path. A public vault <code>modify</code> event updates the already-open Monaco model.' },
  html: { src: ${JSON.stringify(screenshots.html)}, alt:'External HTML rendered by Obsidian core Web Viewer', title:'Rendered HTML stays a separate intent', copy:'The bridge validates the path, then core <code>webviewer</code> opens the original <code>file://</code> URL and fragment.' }
};
const imageEl = document.querySelector('#proof-image');
const titleEl = document.querySelector('#proof-title');
const copyEl = document.querySelector('#proof-copy');
document.querySelectorAll('[data-proof]').forEach(button => button.addEventListener('click', () => {
  const proof = proofs[button.dataset.proof];
  document.querySelectorAll('[data-proof]').forEach(item => item.setAttribute('aria-selected', String(item === button)));
  imageEl.src = proof.src; imageEl.alt = proof.alt; titleEl.textContent = proof.title; copyEl.innerHTML = proof.copy;
}));
</script>
</body>
</html>`;

writeFileSync(resolve(root, 'docs/implementation-gallery.html'), html);
console.log('Wrote docs/implementation-gallery.html');
