import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { isPathWithin, normalizeMountId, resolveExternalFile } from '../src/ExternalPathResolver';
import type { BridgeMount } from '../src/bridgeTypes';

describe('ExternalPathResolver', () => {
	let root: string;
	let outside: string;
	let mount: BridgeMount;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(tmpdir(), 'external-file-bridge-root-'));
		outside = await fs.mkdtemp(path.join(tmpdir(), 'external-file-bridge-outside-'));
		await fs.mkdir(path.join(root, 'project'), { recursive: true });
		await fs.writeFile(path.join(root, 'project', 'main.py'), 'print("bridge")\n');
		await fs.writeFile(path.join(outside, 'secret.py'), 'secret = true\n');
		mount = {
			id: 'home',
			label: 'Home',
			rootPath: root,
			virtualPath: '_External/home',
			enabled: true,
			readOnly: true,
		};
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
		await fs.rm(outside, { recursive: true, force: true });
	});

	it('maps mount-relative links into a stable virtual path', async () => {
		const resolved = await resolveExternalFile([mount], 'home', 'project/main.py');
		expect(resolved.realPath).toBe(path.join(root, 'project', 'main.py'));
		expect(resolved.relativePath).toBe('project/main.py');
		expect(resolved.virtualPath).toBe('_External/home/project/main.py');
	});

	it('accepts a legacy absolute path only when a mount contains it', async () => {
		const resolved = await resolveExternalFile([mount], undefined, path.join(root, 'project', 'main.py'));
		expect(resolved.mount.id).toBe('home');
		await expect(resolveExternalFile([mount], undefined, path.join(outside, 'secret.py')))
			.rejects.toThrow(/outside every configured mount/i);
	});

	it('blocks traversal and symlink escapes after canonicalization', async () => {
		await expect(resolveExternalFile([mount], 'home', `../${path.basename(outside)}/secret.py`))
			.rejects.toThrow(/escapes mount/i);
		await fs.symlink(path.join(outside, 'secret.py'), path.join(root, 'project', 'linked.py'));
		await expect(resolveExternalFile([mount], 'home', 'project/linked.py'))
			.rejects.toThrow(/escapes mount/i);
	});

	it('normalizes mount identifiers and avoids prefix containment mistakes', () => {
		expect(normalizeMountId(' My Projects ')).toBe('my-projects');
		expect(isPathWithin('/home/user', '/home/user2/file.py')).toBe(false);
	});
});
