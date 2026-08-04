// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Minimal shape for the File System Access API's save picker (Chromium-based
	// browsers only). Not in lib.dom.d.ts yet, so declared ambiently here.
	interface SaveFilePickerOptions {
		suggestedName?: string;
		types?: { description?: string; accept: Record<string, string[]> }[];
	}

	interface FileSystemWritableFileStream {
		write(data: Blob): Promise<void>;
		close(): Promise<void>;
	}

	interface FileSystemFileHandle {
		createWritable(): Promise<FileSystemWritableFileStream>;
	}

	interface Window {
		showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
	}
}

export {};
