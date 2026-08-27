import * as Chokidar from 'chokidar';

export type ExternalFileEvent = 'add' | 'change' | 'unlink';

export class ExternalFileWatcher {
	private watchers = new Map<string, Chokidar.FSWatcher>();

	constructor(
		private readonly onEvent: (event: ExternalFileEvent, realPath: string) => Promise<void>,
	) { }

	watch(realPath: string): void {
		if (this.watchers.has(realPath)) return;
		const watcher = Chokidar.watch(realPath, {
			followSymlinks: false,
			ignoreInitial: true,
			persistent: true,
			awaitWriteFinish: {
				stabilityThreshold: 250,
				pollInterval: 50,
			},
		});
		watcher
			.on('add', filePath => { void this.onEvent('add', filePath); })
			.on('change', filePath => { void this.onEvent('change', filePath); })
			.on('unlink', filePath => { void this.onEvent('unlink', filePath); });
		this.watchers.set(realPath, watcher);
	}

	stop(realPath: string): void {
		const watcher = this.watchers.get(realPath);
		if (!watcher) return;
		void watcher.close();
		this.watchers.delete(realPath);
	}

	stopAll(): void {
		for (const watcher of this.watchers.values()) void watcher.close();
		this.watchers.clear();
	}
}
