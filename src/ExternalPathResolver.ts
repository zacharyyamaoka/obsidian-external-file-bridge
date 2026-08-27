import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { normalizePath, type Stat } from 'obsidian';
import type { BridgeMount } from './bridgeTypes';

export interface ResolvedExternalFile {
	mount: BridgeMount;
	realPath: string;
	relativePath: string;
	virtualPath: string;
	stat: Stat;
}

export function isPathWithin(rootPath: string, targetPath: string): boolean {
	const relative = path.relative(rootPath, targetPath);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function normalizeMountId(value: string): string | null {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
	return normalized || null;
}

export async function resolveExternalFile(
	mounts: BridgeMount[],
	mountId: string | undefined,
	requestedPath: string,
): Promise<ResolvedExternalFile> {
	if (!requestedPath || requestedPath.includes('\0')) {
		throw new Error('The external-file link does not contain a valid path.');
	}

	const activeMounts = mounts.filter(mount => mount.enabled);
	let selectedMount: BridgeMount | undefined;
	let candidatePath: string;

	if (mountId) {
		selectedMount = activeMounts.find(mount => mount.id === mountId);
		if (!selectedMount) throw new Error(`Mount "${mountId}" is not configured on this device.`);
		if (path.isAbsolute(requestedPath)) {
			throw new Error('Mount-aware external-file links require a relative path.');
		}
		candidatePath = path.resolve(selectedMount.rootPath, requestedPath);
	} else {
		if (!path.isAbsolute(requestedPath)) {
			throw new Error('Legacy external-file links require an absolute path.');
		}
		candidatePath = requestedPath;
	}

	const canonicalPath = await fs.realpath(candidatePath);
	const canonicalMounts = await Promise.all(activeMounts.map(async mount => ({
		mount,
		rootPath: await fs.realpath(mount.rootPath),
	})));

	if (selectedMount) {
		const canonicalRoot = canonicalMounts.find(item => item.mount.id === selectedMount?.id)?.rootPath;
		if (!canonicalRoot || !isPathWithin(canonicalRoot, canonicalPath)) {
			throw new Error(`The requested file escapes mount "${selectedMount.id}".`);
		}
	} else {
		const matches = canonicalMounts
			.filter(item => isPathWithin(item.rootPath, canonicalPath))
			.sort((left, right) => right.rootPath.length - left.rootPath.length);
		selectedMount = matches[0]?.mount;
		if (!selectedMount) {
			throw new Error('The requested file is outside every configured mount.');
		}
	}

	if (!selectedMount) throw new Error('The requested file is outside every configured mount.');
	const finalMount = selectedMount;
	const canonicalRoot = canonicalMounts.find(item => item.mount.id === finalMount.id)?.rootPath;
	if (!canonicalRoot) throw new Error(`Mount "${finalMount.id}" is unavailable.`);
	const fileStat = await fs.stat(canonicalPath);
	if (!fileStat.isFile()) throw new Error('The requested path is not a regular file.');

	const relativePath = path.relative(canonicalRoot, canonicalPath).split(path.sep).join('/');
	return {
		mount: finalMount,
		realPath: canonicalPath,
		relativePath,
		virtualPath: normalizePath(`${finalMount.virtualPath}/${relativePath}`),
		stat: {
			type: 'file',
			ctime: fileStat.ctimeMs,
			mtime: fileStat.mtimeMs,
			size: fileStat.size,
		},
	};
}
