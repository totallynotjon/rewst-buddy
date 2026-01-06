import { TemplateFragment } from '@sessions';
import vscode from 'vscode';

export interface Org {
	id: string;
	name: string;
}

export type LinkType = 'Folder' | 'Template';

export interface Link {
	uriString: string;
	org: Org;
	type: LinkType;
	stat?: vscode.FileStat;
}

export interface TemplateLink extends Link {
	type: 'Template';
	template: TemplateFragment;
}

export interface FolderLink extends Link {
	type: 'Folder';
}
