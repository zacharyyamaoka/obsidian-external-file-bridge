import {
	App,
	DataAdapter,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	normalizePath,
} from 'obsidian';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ExternalFileWatcher, type ExternalFileEvent } from './src/ExternalFileWatcher';
import { resolveExternalFile, normalizeMountId, type ResolvedExternalFile } from './src/ExternalPathResolver';
import { LocalVirtualAdapter } from './src/LocalVirtualAdapter';
import { SessionFileIndex } from './src/SessionFileIndex';
import {
	createDefaultSettings,
	type BridgeMount,
	type ExternalFileBridgeSettings,
	type RecentExternalFile,
} from './src/bridgeTypes';

const SOURCE_VIEW_TYPE = 'vscode-editor';
const HTML_EXTENSIONS = new Set(['html', 'htm']);

type VaultInternal = {
	onChange(event: string, path: string, prev: null, stat: { type: string; ctime: number; mtime: number; size: number } | null): Promise<void>;
	adapter: DataAdapter;
	getResourcePath(file: TFile): string;
};

type MonacoView = {
	monacoEditor?: {
		focus(): void;
		revealLineInCenter(line: number): void;
		setPosition(position: { lineNumber: number; column: number }): void;
		updateOptions(options: { readOnly: boolean; domReadOnly?: boolean }): void;
	};
};

type AppInternal = App & {
	plugins?: { enabledPlugins?: Set<string> };
	internalPlugins?: {
		getEnabledPluginById?: (id: string) => unknown;
		getPluginById?: (id: string) => unknown;
	};
};

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function toStat(fileStat: Awaited<ReturnType<typeof fs.stat>>): { type: 'file'; ctime: number; mtime: number; size: number } {
	return {
		type: 'file',
		ctime: Number(fileStat.ctimeMs),
		mtime: Number(fileStat.mtimeMs),
		size: Number(fileStat.size),
	};
}

function pathExtension(filePath: string): string {
	return path.extname(filePath).slice(1).toLowerCase();
}

export default class ExternalFileBridgePlugin extends Plugin {
	settings: ExternalFileBridgeSettings = createDefaultSettings(homedir());
	readonly sessionIndex = new SessionFileIndex();
	private virtualAdapter: LocalVirtualAdapter | null = null;
	private watcher: ExternalFileWatcher | null = null;
	private originalAdapter: DataAdapter | null = null;
	private originalGetResourcePath: ((file: TFile) => string) | null = null;

	async onload(): Promise<void> {
		if (!Platform.isDesktopApp) {
			new Notice(`${this.manifest.name} requires Obsidian Desktop.`);
			return;
		}

		await this.loadSettings();
		this.installVirtualAdapter();
		this.watcher = new ExternalFileWatcher((event, realPath) => this.handleExternalFileEvent(event, realPath));

		this.registerObsidianProtocolHandler('external-file', parameters => {
			void this.openExternalFile(parameters);
		});
		this.registerDomEvent(document, 'click', event => this.handleExternalFileClick(event), true);
		this.addSettingTab(new ExternalFileBridgeSettingTab(this.app, this));
		this.addCommand({
			id: 'clear-temporary-external-files',
			name: 'Clear temporary external files',
			callback: () => { void this.clearSession(true); },
		});

		this.app.workspace.onLayoutReady(() => {
			void this.rehydrateRecentFiles();
		});
	}

	onunload(): void {
		this.watcher?.stopAll();
		void this.removeVirtualEntries().finally(() => this.restoreVaultAdapter());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async openExternalFile(parameters: Record<string, string>): Promise<void> {
		try {
			const requestedPath = parameters.path ?? parameters.file ?? '';
			const resolved = await resolveExternalFile(this.settings.mounts, parameters.mount, requestedPath);
			const view = parameters.view ?? parameters.mode;
			if (HTML_EXTENSIONS.has(pathExtension(resolved.realPath)) && view !== 'source') {
				await this.openHtmlInWebViewer(resolved, parameters.fragment ?? '');
				return;
			}

			const line = parameters.line ? Number.parseInt(parameters.line, 10) : undefined;
			await this.openSourceFile(resolved, line);
		} catch (error) {
			new Notice(`External file bridge: ${getErrorMessage(error)}`);
		}
	}

	async exposeExternalFile(mountId: string, relativePath: string, remember = true): Promise<TFile> {
		const resolved = await resolveExternalFile(this.settings.mounts, mountId, relativePath);
		return this.injectResolvedFile(resolved, remember);
	}

	async clearSession(clearRecent: boolean): Promise<void> {
		this.watcher?.stopAll();
		await this.removeVirtualEntries();
		this.sessionIndex.clear();
		if (clearRecent) {
			this.settings.recentFiles = [];
			await this.saveSettings();
			new Notice('External file bridge: temporary files cleared.');
		}
	}

	async validateMountRoot(rootPath: string): Promise<string> {
		const canonicalPath = await fs.realpath(rootPath.trim());
		const stat = await fs.stat(canonicalPath);
		if (!stat.isDirectory()) throw new Error('The mount root must be a directory.');
		return canonicalPath;
	}

	private async loadSettings(): Promise<void> {
		const saved = await this.loadData() as Partial<ExternalFileBridgeSettings> | null;
		const defaults = createDefaultSettings(homedir());
		const mounts = Array.isArray(saved?.mounts) ? saved.mounts : defaults.mounts;
		this.settings = {
			mounts: mounts
				.filter(mount => mount && typeof mount.id === 'string' && typeof mount.rootPath === 'string')
				.map(mount => ({
					id: normalizeMountId(mount.id) ?? 'external',
					label: mount.label?.trim() || mount.id,
					rootPath: mount.rootPath,
					virtualPath: normalizePath(mount.virtualPath || `_External/${mount.id}`),
					enabled: mount.enabled !== false,
					readOnly: true,
				})),
			recentFiles: Array.isArray(saved?.recentFiles) ? saved.recentFiles : [],
			maxRecentFiles: Number.isFinite(saved?.maxRecentFiles) ? Math.max(1, Number(saved?.maxRecentFiles)) : defaults.maxRecentFiles,
		};
		if (this.settings.mounts.length === 0) this.settings.mounts = defaults.mounts;
	}

	private installVirtualAdapter(): void {
		const vault = this.app.vault as typeof this.app.vault & VaultInternal;
		this.originalAdapter = vault.adapter;
		// Obsidian's runtime vault method is stable but incompletely typed in the public API.
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		this.originalGetResourcePath = vault.getResourcePath.bind(vault);
		this.virtualAdapter = new LocalVirtualAdapter(vault.adapter, this.sessionIndex);

		const original = vault.adapter;
		vault.adapter = new Proxy(this.virtualAdapter, {
			get(target, property, receiver) {
				if (property in target) {
					const value = Reflect.get(target, property, receiver) as unknown;
					// ProxyHandler.get is typed as any by TypeScript even though value is narrowed here.
					// eslint-disable-next-line @typescript-eslint/no-unsafe-return
					return typeof value === 'function' ? value.bind(target) : value;
				}
				const value = Reflect.get(original as object, property, original) as unknown;
				// ProxyHandler.get is typed as any by TypeScript even though value is narrowed here.
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return typeof value === 'function' ? value.bind(original) : value;
			},
		});

		vault.getResourcePath = (file: TFile): string => {
			if (this.sessionIndex.getFile(file.path)) return this.virtualAdapter?.getResourcePath(file.path) ?? '';
			return this.originalGetResourcePath?.(file) ?? '';
		};
	}

	private restoreVaultAdapter(): void {
		const vault = this.app.vault as typeof this.app.vault & VaultInternal;
		if (this.originalAdapter) vault.adapter = this.originalAdapter;
		if (this.originalGetResourcePath) vault.getResourcePath = this.originalGetResourcePath;
		this.virtualAdapter = null;
	}

	private async openSourceFile(resolved: ResolvedExternalFile, line?: number): Promise<void> {
		const file = await this.injectResolvedFile(resolved, true);
		const leaf = this.app.workspace.getLeaf(true);
		const vscodeEditorEnabled = (this.app as AppInternal).plugins?.enabledPlugins?.has('vscode-editor') ?? false;
		if (vscodeEditorEnabled) {
			await leaf.setViewState({
				type: SOURCE_VIEW_TYPE,
				state: { file: file.path },
				active: true,
			});
		} else {
			new Notice('External file bridge: VSCode Editor is disabled; using Obsidian\'s available file view.');
			await leaf.openFile(file, { active: true });
		}

		await new Promise<void>(resolve => window.setTimeout(resolve, 0));
		const editor = (leaf.view as unknown as MonacoView).monacoEditor;
		if (!editor) return;
		editor.updateOptions({ readOnly: true, domReadOnly: true });
		if (line && Number.isFinite(line) && line > 0) {
			editor.setPosition({ lineNumber: Math.floor(line), column: 1 });
			editor.revealLineInCenter(Math.floor(line));
		}
		editor.focus();
	}

	private async openHtmlInWebViewer(resolved: ResolvedExternalFile, fragment: string): Promise<void> {
		await this.injectResolvedFile(resolved, true);
		const url = pathToFileURL(resolved.realPath);
		if (fragment) url.hash = fragment.replace(/^#/, '');

		const internalPlugins = (this.app as AppInternal).internalPlugins;
		const enabled = internalPlugins?.getEnabledPluginById?.('webviewer') as {
			instance?: { openUrl?: (url: string) => Promise<void> | void };
			openUrl?: (url: string) => Promise<void> | void;
		} | undefined;
		const registered = internalPlugins?.getPluginById?.('webviewer') as {
			instance?: { openUrl?: (url: string) => Promise<void> | void };
		} | undefined;
		const webViewer = enabled?.instance ?? enabled ?? registered?.instance;
		if (!webViewer?.openUrl) {
			new Notice('External file bridge: core web viewer is disabled; showing HTML source.');
			await this.openSourceFile(resolved);
			return;
		}
		await webViewer.openUrl(url.toString());
	}

	private async injectResolvedFile(resolved: ResolvedExternalFile, remember: boolean): Promise<TFile> {
		const vault = this.app.vault as typeof this.app.vault & VaultInternal;
		const before = new Set(this.sessionIndex.getFoldersDeepestFirst());
		this.sessionIndex.exposeFile({
			virtualPath: resolved.virtualPath,
			realPath: resolved.realPath,
			mountId: resolved.mount.id,
			stat: resolved.stat,
		});

		const folders = this.sessionIndex.getFoldersDeepestFirst().reverse();
		for (const folderPath of folders) {
			if (before.has(folderPath) || this.app.vault.getAbstractFileByPath(folderPath)) continue;
			await vault.onChange('folder-created', folderPath, null, null);
		}

		if (!this.app.vault.getAbstractFileByPath(resolved.virtualPath)) {
			await vault.onChange('file-created', resolved.virtualPath, null, resolved.stat);
		}
		const file = this.app.vault.getAbstractFileByPath(resolved.virtualPath);
		if (!(file instanceof TFile)) throw new Error('Obsidian did not register the temporary external file.');
		this.watcher?.watch(resolved.realPath);

		if (remember) await this.rememberFile(resolved.mount.id, resolved.relativePath);
		return file;
	}

	private async rememberFile(mountId: string, relativePath: string): Promise<void> {
		const normalized: RecentExternalFile = { mountId, relativePath };
		this.settings.recentFiles = [
			normalized,
			...this.settings.recentFiles.filter(item => item.mountId !== mountId || item.relativePath !== relativePath),
		].slice(0, this.settings.maxRecentFiles);
		await this.saveSettings();
	}

	private async rehydrateRecentFiles(): Promise<void> {
		for (const recent of this.settings.recentFiles) {
			try {
				await this.exposeExternalFile(recent.mountId, recent.relativePath, false);
			} catch {
				// Files can move while Obsidian is closed; stale recents are harmless.
			}
		}
	}

	private async handleExternalFileEvent(event: ExternalFileEvent, realPath: string): Promise<void> {
		const entry = this.sessionIndex.getFiles().find(item => item.realPath === path.resolve(realPath));
		if (!entry) return;
		const vault = this.app.vault as typeof this.app.vault & VaultInternal;

		if (event === 'unlink') {
			this.watcher?.stop(entry.realPath);
			if (this.app.vault.getAbstractFileByPath(entry.virtualPath)) {
				await vault.onChange('file-removed', entry.virtualPath, null, null);
			}
			const removedFolders = this.sessionIndex.removeFile(entry.virtualPath);
			for (const folderPath of removedFolders) {
				if (this.app.vault.getAbstractFileByPath(folderPath)) {
					await vault.onChange('folder-removed', folderPath, null, null);
				}
			}
			return;
		}

		try {
			const fileStat = await fs.stat(entry.realPath);
			if (!fileStat.isFile()) return;
			const stat = toStat(fileStat);
			this.sessionIndex.updateStat(entry.virtualPath, stat);
			const file = this.app.vault.getAbstractFileByPath(entry.virtualPath);
			if (file instanceof TFile) {
				file.stat = stat;
				this.app.vault.trigger('modify', file);
				this.app.vault.trigger('raw', entry.virtualPath);
			} else {
				await vault.onChange('file-created', entry.virtualPath, null, stat);
			}
		} catch {
			// The watcher can race an atomic save; a subsequent add/change event retries.
		}
	}

	private async removeVirtualEntries(): Promise<void> {
		const vault = this.app.vault as typeof this.app.vault & VaultInternal;
		for (const entry of this.sessionIndex.getFiles()) {
			if (this.app.vault.getAbstractFileByPath(entry.virtualPath)) {
				await vault.onChange('file-removed', entry.virtualPath, null, null);
			}
		}
		for (const folderPath of this.sessionIndex.getFoldersDeepestFirst()) {
			if (this.app.vault.getAbstractFileByPath(folderPath)) {
				await vault.onChange('folder-removed', folderPath, null, null);
			}
		}
	}

	private handleExternalFileClick(event: MouseEvent): void {
		const element = event.target instanceof Element ? event.target : null;
		const anchor = element?.closest('a');
		const href = anchor?.getAttribute('href') ?? '';
		if (!href.startsWith('obsidian://external-file?')) return;

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		try {
			const url = new URL(href);
			void this.openExternalFile(Object.fromEntries(url.searchParams.entries()));
		} catch (error) {
			new Notice(`External file bridge: invalid link (${getErrorMessage(error)}).`);
		}
	}
}

class ExternalFileBridgeSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly bridge: ExternalFileBridgePlugin) {
		super(app, bridge);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName('File access').setHeading();
		containerEl.createEl('p', {
			text: 'External files stay in their original folders. Only files you open appear temporarily under _External, and every mount is read-only.',
			cls: 'setting-item-description',
		});

		for (const mount of this.bridge.settings.mounts) this.renderMount(containerEl, mount);

		new Setting(containerEl)
			.setName('Add mount')
			.setDesc('Add another stable machine-local root for portable external-file links.')
			.addButton(button => button.setButtonText('Add').onClick(async () => {
				let suffix = this.bridge.settings.mounts.length + 1;
				while (this.bridge.settings.mounts.some(mount => mount.id === `mount-${suffix}`)) suffix++;
				this.bridge.settings.mounts.push({
					id: `mount-${suffix}`,
					label: `Mount ${suffix}`,
					rootPath: homedir(),
					virtualPath: `_External/mount-${suffix}`,
					enabled: true,
					readOnly: true,
				});
				await this.bridge.saveSettings();
				this.display();
			}));

		new Setting(containerEl)
			.setName('Temporary file index')
			.setDesc(`${this.bridge.sessionIndex.getFiles().length} external file(s) are currently visible to Obsidian. No files were copied into the vault.`)
			.addButton(button => button.setButtonText('Clear').onClick(async () => {
				await this.bridge.clearSession(true);
				this.display();
			}));
	}

	private renderMount(containerEl: HTMLElement, mount: BridgeMount): void {
		const heading = new Setting(containerEl)
			.setName(mount.label || mount.id)
			.setDesc(`obsidian://external-file?mount=${mount.id}&path=relative/path.py&view=source`)
			.addToggle(toggle => toggle.setValue(mount.enabled).onChange(async enabled => {
				mount.enabled = enabled;
				await this.bridge.clearSession(false);
				await this.bridge.saveSettings();
			}));
		if (this.bridge.settings.mounts.length > 1) {
			heading.addExtraButton(button => button.setIcon('trash-2').setTooltip('Remove mount').onClick(async () => {
				this.bridge.settings.mounts = this.bridge.settings.mounts.filter(item => item !== mount);
				await this.bridge.clearSession(true);
				await this.bridge.saveSettings();
				this.display();
			}));
		}

		new Setting(containerEl)
			.setName('Mount ID')
			.setDesc('Stable identifier stored in links.')
			.addText(text => text.setValue(mount.id).onChange(async value => {
				const nextId = normalizeMountId(value);
				if (!nextId || this.bridge.settings.mounts.some(item => item !== mount && item.id === nextId)) return;
				mount.id = nextId;
				mount.virtualPath = `_External/${nextId}`;
				await this.bridge.saveSettings();
			}));

		new Setting(containerEl)
			.setName('Label')
			.addText(text => text.setValue(mount.label).onChange(async value => {
				mount.label = value.trim() || mount.id;
				await this.bridge.saveSettings();
			}));

		new Setting(containerEl)
			.setName('Root folder')
			.setDesc('Absolute local folder. Symlinks are resolved before access is allowed.')
			.addText(text => {
				text.setValue(mount.rootPath);
				text.inputEl.addClass('external-file-bridge-root-input');
				text.onChange(value => { mount.rootPath = value.trim(); });
			})
			.addButton(button => button.setButtonText('Validate & save').onClick(async () => {
				try {
					mount.rootPath = await this.bridge.validateMountRoot(mount.rootPath);
					await this.bridge.clearSession(true);
					await this.bridge.saveSettings();
					new Notice(`External file bridge: saved ${mount.rootPath}`);
					this.display();
				} catch (error) {
					new Notice(`External file bridge: ${getErrorMessage(error)}`);
				}
			}));
	}
}
