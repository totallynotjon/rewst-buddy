/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as path from 'path';
import * as vscode from 'vscode';
import RewstClient from '../rewst-client/RewstClient.js';
import Tree from './models/Tree.js';
import { TemplateCreateInput } from '../graphql_sdk.js';
import Entry, { Directory, ReadonlyDirectory, TemplateDirectory } from './models/Entry.js';
import Org from './models/Org.js';
import { Template } from './models/Template.js';
import { uuidv7 } from 'uuidv7';

export default class RewstFS implements vscode.FileSystemProvider {
    tree: Tree
    public static get scheme(): string { return `rewstfs` };
    public static get schema(): string { return `${RewstFS.scheme}://`; }

    public static uriOf(relPath: string) {
        return vscode.Uri.parse(`${RewstFS.schema}${relPath}`);
    }

    constructor() {
        const root = new ReadonlyDirectory("", RewstFS.schema);
        this.tree = new Tree(root);
    }


    //#region fs ops
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const entry = this._lookupEntry(uri);
        return entry;
    }

    private _lookupEntry(uri: vscode.Uri): Entry {
        const entry = this.tree.lookupEntry(uri);
        if (entry === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return entry;
    }

    private _lookupDirectory(uri: vscode.Uri): Directory {
        const entry = this._lookupEntry(uri);
        if (!(entry instanceof Directory)) {
            throw vscode.FileSystemError.FileNotADirectory(uri);
        }
        return entry;
    }

    private _lookupOrg(uri: vscode.Uri): Org {
        const entry = this._lookupEntry(uri);

        const orgUri = RewstFS.uriOf(entry.getOrgId());



        const org: Org | Entry = this._lookupEntry(orgUri);

        if (!(org instanceof Org)) {
            throw new Error("not an org");
        }
        return org;
    }

    public lookupOrg(entry: Entry): Org {

        const orgUri = RewstFS.uriOf(entry.getOrgId());

        const org: Org | Entry = this._lookupEntry(orgUri);

        if (!(org instanceof Org)) {
            throw new Error("not an org");
        }
        return org;
    }

    public async createTemplate(dir: Directory, label: string): Promise<Template> {
        const org = this._lookupOrg(dir.getUri());
        const input = {
            name: label,
            orgId: dir.getOrgId()
        }
        const response = await org.rewstClient.sdk.createTemplateMinimal(input);

        if (!response.template) {
            const message = `Failed to generate template`;
            throw new Error("message");
        }
        const template = new Template(response.template.id, response.template.name);

        dir.addChild(template);
        return template;
    }

    public async createTemplateFolder(dir: Directory, label: string): Promise<Directory> {
        const newFolder = new TemplateDirectory(uuidv7(), label);
        newFolder.addViewContext("has-templatefolders");
        dir.addChild(newFolder);
        return newFolder;
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const dir = this._lookupDirectory(uri);
        const result: [string, vscode.FileType][] = [];

        for (const child of dir.children) {
            result.push([child.getLabel(), child.type]);
        }
        return result;
    }

    createDirectory(uri: vscode.Uri): void | Promise<void> {
        throw new Error('Method not implemented.');
    }
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const entry = this._lookupEntry(uri);
        if (entry.type !== vscode.FileType.File) {
            throw vscode.FileSystemError.FileIsADirectory(uri);
        }

        if (!(entry instanceof Template)) {
            throw new Error(`Error reading file ${uri}, not instance of template`);
        }

        const template: Template = entry;

        if (template.data === undefined) {
            const org = this._lookupOrg(template.getUri());
            return await template.loadData(org.rewstClient);
        }

        return template.data;
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): Promise<void> {
        const entry = this._lookupEntry(uri);
        if (entry.type !== vscode.FileType.File) {
            throw vscode.FileSystemError.FileIsADirectory(uri);
        }

        if (!(entry instanceof Template)) {
            throw new Error(`Error reading file ${uri}, not instance of template`);
        }

        const template: Template = entry;
        template.data = content;

        const org = this._lookupOrg(entry.getUri());

        const payload = {
            "id": template.id,
            "body": content.toString()
        };
        await org.rewstClient.sdk.UpdateTemplateBody(payload);

    }
    delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Promise<void> {
        throw new Error('Method not implemented.');
    }
    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Promise<void> {
        throw new Error('Method not implemented.');
    }
    copy?(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Promise<void> {
        throw new Error('Method not implemented.');
    }

    move(source: vscode.Uri, destination: vscode.Uri): void {
        const srcEntity = this._lookupEntry(source);
        const destEntity = this._lookupDirectory(destination);

        if (srcEntity.getOrgId() !== destEntity.getOrgId()) {
            vscode.window.showErrorMessage("Can't move across orgs")
            throw new Error("Can't move across orgs");
        }

        if (srcEntity instanceof Template) {
            if (destEntity.contextValue.indexOf("has-templates") < 0) {
                const message = "Can't move template into not a template folder"
                vscode.window.showErrorMessage(message);
                throw new Error(message);
            }
        }

        srcEntity.moveTo(destEntity);
    }


    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _bufferedEvents: vscode.FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timeout;

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(_resource: vscode.Uri): vscode.Disposable {
        // ignore, fires for all changes...
        return new vscode.Disposable(() => { });
    }

    private _fireSoon(...events: vscode.FileChangeEvent[]): void {
        this._bufferedEvents.push(...events);

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0;
        }, 5);
    }

    //#endregion
}