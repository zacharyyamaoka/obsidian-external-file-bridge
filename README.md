# External File Bridge

Open local files in Obsidian without copying, symlinking, or permanently importing them into the vault.

External File Bridge turns one explicitly requested local path into a temporary, read-only Obsidian `TFile`. Source files are handed to [VSCode Editor](https://github.com/sunxvming/obsidian-vscode-editor) for its bundled Monaco view; rendered HTML is handed to Obsidian's core Web Viewer. The original bytes always remain at their real filesystem path.

See the [architecture](docs/ARCHITECTURE.md) and [implementation gallery](docs/implementation-gallery.html).

## What ships

- `external-file-bridge` — this plugin: mount resolution, containment checks, session-only `TFile` injection, read-only adapter access, file watching, and the `obsidian://external-file` protocol.
- VSCode Editor — a separate renderer plugin. It owns Monaco; this bridge does not bundle or fork it.
- Core Web Viewer — Obsidian's renderer for explicit `view=rendered` HTML links.
- `link-for` and `link-doctor` — optional companion commands maintained outside this repository for generating and checking mount-aware links.

The runtime is intentionally local-only and desktop-only. It does not enumerate a mounted folder, index a repository, write through to external files, or include Folder Bridge's WebDAV, S3, SFTP, mobile, or whole-tree mount features.

## Link format

```text
obsidian://external-file?mount=home&path=projects%2Fdemo%2Fmain.py&view=source&line=42
obsidian://external-file?mount=home&path=reports%2Fresult.html&view=rendered&fragment=summary
```

- `mount` is a stable ID mapped to a device-local root in plugin settings.
- `path` is relative to that root. Canonicalization blocks `..` and symlink escapes.
- `view=source` opens the temporary file in VSCode Editor when available.
- `view=rendered` sends HTML to the core Web Viewer.
- `line` and `fragment` are optional navigation hints.

Legacy absolute `path=` links remain readable only when their canonical path is contained by an enabled mount. New links should use `mount` plus a relative `path`.

## Install

This fork currently uses a manual development install:

1. Run `npm ci && npm run validate`.
2. Copy `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/external-file-bridge/`.
3. Install [VSCode Editor release 1.0.5](https://github.com/sunxvming/obsidian-vscode-editor/releases/tag/1.0.5) as the separate `vscode-editor` plugin.
4. Enable VSCode Editor, External File Bridge, and Obsidian's core Web Viewer.
5. Add stable local roots under **Settings → External File Bridge**.

The default settings create one read-only `home` mount rooted at the current user's home directory. Narrower mounts can be added; the most specific containing mount should be used when generating links.

## Development and verification

```bash
npm ci
npm run validate
npm audit --omit=dev
```

The current proof set covers:

- 141 unit tests across the inherited baseline and new resolver/session-index cases;
- zero production dependency audit findings;
- an isolated Obsidian 1.13.7 click opening an external Python file in a real Monaco view;
- line navigation and enforced read-only editor state;
- no physical `_External` file inside the vault;
- live Monaco refresh after the original file changes on disk;
- rendered HTML opening in the core Web Viewer.

Screenshots and the exact runtime composition are in the [self-contained implementation gallery](docs/implementation-gallery.html).

## Lineage

This repository preserves the Git history and MIT license of [Folder Bridge](https://github.com/tescolopio/Obsidian_FolderBridge) by Timmothy Escolopio. Folder Bridge supplied the original virtual-adapter and vault-injection ideas. This fork deliberately narrows that architecture to on-demand, local, read-only file access and keeps VSCode Editor as an independent renderer.
