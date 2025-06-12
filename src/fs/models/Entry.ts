import * as path from 'path';
import * as vscode from 'vscode';
import RewstFS from '../RewstFS.js';
import RewstClient from '../../rewst-client/RewstClient.js';
import FolderStructure from './FolderStructure.js';

export default class Entry extends vscode.TreeItem implements vscode.FileStat {
    ctime: number;
    mtime: number;
    size: number;
    permissions?: vscode.FilePermission | undefined;
    type: vscode.FileType = vscode.FileType.Unknown;
    parent !: Entry;
    children !: Entry[];
    ext !: string;

    constructor(
        public id: string,
        public label: string,
    ) {
        if (id.indexOf('/') > -1) {
            throw new Error(`Id cannot contain character '/'  id: ${id},label:${label} `);
        }
        super(label);
        this.ctime = Date.now();
        this.mtime = Date.now();
        this.size = 0;
    }

    addViewContext(value: string) {
        this.contextValue = `${this.contextValue} ${value}`;
    }

    getUri(): vscode.Uri {

        if (this.parent === undefined) {
            return RewstFS.uriOf("/");
        }

        if (this.parent.id === '') {
            return RewstFS.uriOf(this.id);
        }

        const parentUri = this.parent.getUri();
        const newPath = path.posix.join("/", parentUri.path, this.ext ? `${this.id}.${this.ext}` : this.id);
        return parentUri.with({ path: newPath });
    }

    public static getUriParts(uri: vscode.Uri): string[] {
        const noScheme = uri.toString().replace(RewstFS.schema, "");
        const parts = noScheme.split("/");
        return parts;
    }

    static getOrgId(uri: vscode.Uri): string {
        return uri.authority;
    }

    static getParentUri(uri: vscode.Uri): vscode.Uri {
        const dirPath = path.posix.dirname(uri.path);

        const parentUri = uri.with({ path: dirPath });
        return parentUri;
    }

    getLabel(): string {
        return this.label;
    }
    setLabel(label: string, client?: RewstClient): void {
        this.label = label;
    }

    getOrgId(): string {
        return Entry.getOrgId(this.getUri());
    }

    getParentUri(): vscode.Uri {
        return this.parent.getUri();
    }

    addChild(child: Entry): void {
        this.children = this.children.filter(c => c.id !== child.id)
        this.children.push(child);
        child.parent = this;
    }

    // Remove a child node and clear its parent reference
    removeChild(child: Entry): boolean {
        const index = this.children.indexOf(child);
        if (index === -1) {
            return false;
        }
        this.children.splice(index, 1);
        return true;
    }

    // Optional: Move a node to a new parent
    moveTo(newParent: Entry): void {
        if (this.parent) {
            this.parent.removeChild(this);
        }
        newParent.addChild(this);
    }

    getStructure(): FolderStructure | undefined {
        if (this instanceof TemplateDirectory && this.children.length == 0) {
            return undefined;
        }
        return {
            "id": this.id,
            "label": this.label,
            "children": this.children ? this.children.map(c => c.getStructure()).filter(c => c !== undefined) : [],
            "ext": this.ext
        }
    }

    isValidLabel(label: string): boolean {
        return /^[a-zA-Z0-9\[\]\- ]*$/.test(label);
    }
}

export class Directory extends Entry {
    contextValue = "directory renamable";
    type: vscode.FileType = vscode.FileType.Directory;
    collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    children: Entry[] = [];
}

export class ReadonlyDirectory extends Directory {
    contextValue = "directory";
    permissions = vscode.FilePermission.Readonly;
}

export class TemplateDirectory extends Directory {
    contextValue: string = "directory renamable has-templates has-templatefolders"
}