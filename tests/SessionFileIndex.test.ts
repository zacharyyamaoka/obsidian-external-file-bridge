import { describe, expect, it } from 'vitest';
import { SessionFileIndex } from '../src/SessionFileIndex';

const stat = { type: 'file' as const, ctime: 1, mtime: 2, size: 3 };

describe('SessionFileIndex', () => {
	it('exposes only the requested file and its synthetic parents', () => {
		const index = new SessionFileIndex();
		index.exposeFile({
			virtualPath: '_External/home/project/src/main.py',
			realPath: '/home/user/project/src/main.py',
			mountId: 'home',
			stat,
		});

		expect(index.list('_External/home/project/src')).toEqual({
			files: ['_External/home/project/src/main.py'],
			folders: [],
		});
		expect(index.list('_External/home/project')).toEqual({
			files: [],
			folders: ['_External/home/project/src'],
		});
		expect(index.getFiles()).toHaveLength(1);
	});

	it('treats every child of the temporary namespace as read-only', () => {
		const index = new SessionFileIndex();
		index.exposeFile({
			virtualPath: '_External/home/project/main.py',
			realPath: '/home/user/project/main.py',
			mountId: 'home',
			stat,
		});

		expect(index.ownsPath('_External/home/project/main.py')).toBe(true);
		expect(index.ownsPath('_External/home/project/new.py')).toBe(true);
		expect(index.ownsPath('Notes/new.py')).toBe(false);
	});

	it('prunes empty synthetic folders when a file disappears', () => {
		const index = new SessionFileIndex();
		index.exposeFile({
			virtualPath: '_External/home/a/b.py',
			realPath: '/home/user/a/b.py',
			mountId: 'home',
			stat,
		});

		const removed = index.removeFile('_External/home/a/b.py');
		expect(removed).toContain('_External/home/a');
		expect(index.getFiles()).toHaveLength(0);
		expect(index.list('')).toEqual({ files: [], folders: [] });
	});
});
