import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { normalizePath, type DataAdapter, type DataWriteOptions, type ListedFiles, type Stat } from 'obsidian';
import { SessionFileIndex } from './SessionFileIndex';

/**
 * Read-only adapter shim for paths exposed by SessionFileIndex.
 *
 * Every non-session path delegates to Obsidian's original adapter unchanged.
 * Session folders are synthetic and list only paths that were explicitly
 * exposed; opening one file never enumerates its external repository or home.
 */
export class LocalVirtualAdapter implements DataAdapter {
	constructor(
		private readonly original: DataAdapter,
		private readonly index: SessionFileIndex,
	) { }

	orig(): DataAdapter {
		return this.original;
	}

	getName(): string {
		return this.original.getName();
	}

	getFullPath(normalizedPath: string): string {
		return this.index.getFile(normalizedPath)?.realPath
			?? (this.original as DataAdapter & { getFullPath?: (path: string) => string }).getFullPath?.(normalizedPath)
			?? normalizedPath;
	}

	async exists(normalizedPath: string, sensitive?: boolean): Promise<boolean> {
		if (this.index.isVirtual(normalizedPath)) return true;
		return this.original.exists(normalizedPath, sensitive);
	}

	async stat(normalizedPath: string): Promise<Stat | null> {
		const entry = this.index.get(normalizedPath);
		if (entry?.kind === 'file') return entry.stat;
		if (entry?.kind === 'folder') {
			return { type: 'folder', ctime: 0, mtime: Date.now(), size: 0 };
		}
		return this.original.stat(normalizedPath);
	}

	async list(normalizedPath: string): Promise<ListedFiles> {
		const virtual = this.index.list(normalizedPath);
		if (this.index.isVirtual(normalizedPath)) return virtual;

		let listed: ListedFiles;
		try {
			listed = await this.original.list(normalizedPath);
		} catch {
			listed = { files: [], folders: [] };
		}
		for (const file of virtual.files) if (!listed.files.includes(file)) listed.files.push(file);
		for (const folder of virtual.folders) if (!listed.folders.includes(folder)) listed.folders.push(folder);
		return listed;
	}

	async read(normalizedPath: string): Promise<string> {
		const entry = this.index.getFile(normalizedPath);
		if (!entry) return this.original.read(normalizedPath);
		return fs.readFile(entry.realPath, 'utf8');
	}

	async cachedRead(normalizedPath: string): Promise<string> {
		const entry = this.index.getFile(normalizedPath);
		if (entry) return fs.readFile(entry.realPath, 'utf8');
		const original = this.original as DataAdapter & { cachedRead?: (path: string) => Promise<string> };
		return typeof original.cachedRead === 'function'
			? original.cachedRead(normalizedPath)
			: this.original.read(normalizedPath);
	}

	async readBinary(normalizedPath: string): Promise<ArrayBuffer> {
		const entry = this.index.getFile(normalizedPath);
		if (!entry) return this.original.readBinary(normalizedPath);
		const buffer = await fs.readFile(entry.realPath);
		return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	}

	getResourcePath(normalizedPath: string): string {
		const entry = this.index.getFile(normalizedPath);
		return entry ? pathToFileURL(entry.realPath).toString() : this.original.getResourcePath(normalizedPath);
	}

	async write(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void> {
		this.assertWritable(normalizedPath);
		return this.original.write(normalizedPath, data, options);
	}

	async writeBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
		this.assertWritable(normalizedPath);
		return this.original.writeBinary(normalizedPath, data, options);
	}

	async append(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void> {
		this.assertWritable(normalizedPath);
		return this.original.append(normalizedPath, data, options);
	}

	async appendBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
		this.assertWritable(normalizedPath);
		const original = this.original as DataAdapter & { appendBinary?: (path: string, value: ArrayBuffer, options?: DataWriteOptions) => Promise<void> };
		if (typeof original.appendBinary !== 'function') throw new Error('The original vault adapter does not support appendBinary.');
		return original.appendBinary(normalizedPath, data, options);
	}

	async process(normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions): Promise<string> {
		this.assertWritable(normalizedPath);
		return this.original.process(normalizedPath, fn, options);
	}

	async mkdir(normalizedPath: string): Promise<void> {
		this.assertWritable(normalizedPath);
		return this.original.mkdir(normalizedPath);
	}

	async trashSystem(normalizedPath: string): Promise<boolean> {
		this.assertWritable(normalizedPath);
		return this.original.trashSystem(normalizedPath);
	}

	async trashLocal(normalizedPath: string): Promise<void> {
		this.assertWritable(normalizedPath);
		return this.original.trashLocal(normalizedPath);
	}

	async rmdir(normalizedPath: string, recursive: boolean): Promise<void> {
		this.assertWritable(normalizedPath);
		return this.original.rmdir(normalizedPath, recursive);
	}

	async remove(normalizedPath: string): Promise<void> {
		this.assertWritable(normalizedPath);
		return this.original.remove(normalizedPath);
	}

	async rename(normalizedPath: string, normalizedNewPath: string): Promise<void> {
		this.assertWritable(normalizedPath, normalizedNewPath);
		return this.original.rename(normalizedPath, normalizedNewPath);
	}

	async copy(normalizedPath: string, normalizedNewPath: string): Promise<void> {
		this.assertWritable(normalizedPath, normalizedNewPath);
		return this.original.copy(normalizedPath, normalizedNewPath);
	}

	private assertWritable(...paths: string[]): void {
		if (paths.some(path => this.index.ownsPath(normalizePath(path)))) {
			throw new Error('External File Bridge: temporary external files are read-only.');
		}
	}
}
