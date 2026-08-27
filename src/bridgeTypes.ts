export interface BridgeMount {
	id: string;
	label: string;
	rootPath: string;
	virtualPath: string;
	enabled: boolean;
	readOnly: true;
}

export interface RecentExternalFile {
	mountId: string;
	relativePath: string;
}

export interface ExternalFileBridgeSettings {
	mounts: BridgeMount[];
	recentFiles: RecentExternalFile[];
	maxRecentFiles: number;
}

export function createDefaultSettings(homePath: string): ExternalFileBridgeSettings {
	return {
		mounts: [{
			id: 'home',
			label: 'Home',
			rootPath: homePath,
			virtualPath: '_External/home',
			enabled: true,
			readOnly: true,
		}],
		recentFiles: [],
		maxRecentFiles: 50,
	};
}
