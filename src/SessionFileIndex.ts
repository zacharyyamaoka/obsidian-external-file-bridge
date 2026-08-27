import { normalizePath, type Stat } from 'obsidian';

export interface SessionFileEntry {
	kind: 'file';
	virtualPath: string;
	realPath: string;
	mountId: string;
	stat: Stat;
}

interface SessionFolderEntry {
	kind: 'folder';
	virtualPath: string;
}

type SessionEntry = SessionFileEntry | SessionFolderEntry;

export class SessionFileIndex {
	private entries = new Map<string, SessionEntry>();

	exposeFile(entry: Omit<SessionFileEntry, 'kind'>): SessionFileEntry {
		const virtualPath = normalizePath(entry.virtualPath);
		const segments = virtualPath.split('/');
		for (let index = 1; index < segments.length; index++) {
			const folderPath = segments.slice(0, index).join('/');
			if (!this.entries.has(folderPath)) {
				this.entries.set(folderPath, { kind: 'folder', virtualPath: folderPath });
			}
		}

		const exposed: SessionFileEntry = { ...entry, kind: 'file', virtualPath };
		this.entries.set(virtualPath, exposed);
		return exposed;
	}

	get(path: string): SessionEntry | undefined {
		return this.entries.get(normalizePath(path));
	}

	getFile(path: string): SessionFileEntry | undefined {
		const entry = this.get(path);
		return entry?.kind === 'file' ? entry : undefined;
	}

	isVirtual(path: string): boolean {
		return this.entries.has(normalizePath(path));
	}

	/** True for indexed entries and paths nested under an indexed folder. */
	ownsPath(path: string): boolean {
		const normalized = normalizePath(path);
		if (this.entries.has(normalized)) return true;
		const segments = normalized.split('/');
		for (let index = segments.length - 1; index > 0; index--) {
			const ancestor = this.entries.get(segments.slice(0, index).join('/'));
			if (ancestor?.kind === 'folder') return true;
		}
		return false;
	}

	updateStat(path: string, stat: Stat): SessionFileEntry | undefined {
		const entry = this.getFile(path);
		if (!entry) return undefined;
		entry.stat = stat;
		return entry;
	}

	list(path: string): { files: string[]; folders: string[] } {
		const normalized = normalizePath(path);
		const prefix = normalized ? normalized + '/' : '';
		const files: string[] = [];
		const folders: string[] = [];

		for (const entry of this.entries.values()) {
			if (!entry.virtualPath.startsWith(prefix) || entry.virtualPath === normalized) continue;
			const remainder = entry.virtualPath.slice(prefix.length);
			if (remainder.includes('/')) continue;
			if (entry.kind === 'file') files.push(entry.virtualPath);
			else folders.push(entry.virtualPath);
		}

		return { files: files.sort(), folders: folders.sort() };
	}

	getFiles(): SessionFileEntry[] {
		return [...this.entries.values()].filter((entry): entry is SessionFileEntry => entry.kind === 'file');
	}

	getFoldersDeepestFirst(): string[] {
		return [...this.entries.values()]
			.filter((entry): entry is SessionFolderEntry => entry.kind === 'folder')
			.map(entry => entry.virtualPath)
			.sort((left, right) => right.split('/').length - left.split('/').length);
	}

	removeFile(path: string): string[] {
		this.entries.delete(normalizePath(path));
		const removedFolders: string[] = [];
		for (const folderPath of this.getFoldersDeepestFirst()) {
			const children = this.list(folderPath);
			if (children.files.length === 0 && children.folders.length === 0) {
				this.entries.delete(folderPath);
				removedFolders.push(folderPath);
			}
		}
		return removedFolders;
	}

	clear(): void {
		this.entries.clear();
	}
}
