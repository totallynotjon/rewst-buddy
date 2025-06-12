import { TreeItemCollapsibleState, FileType } from 'vscode';
import Entry from './Entry.js';
import RewstClient from '../../rewst-client/RewstClient.js';
import * as vscode from 'vscode';


export class Template extends Entry {
    contextValue: string = "is-template renamable";
    collapsibleState = TreeItemCollapsibleState.None;
    type: FileType = FileType.File;
    data?: Uint8Array;
    ext = "ps1";

    getCommand() {
        return {
            title: 'Open File',
            command: 'vscode.open',
            arguments: [this.getUri()]
        };
    };


    async loadData(client: RewstClient): Promise<Uint8Array<ArrayBufferLike>> {
        console.log(` loading template ${this.id}`);
        const response = await client.sdk.getTemplateBody({ "id": this.id });
        if (typeof response.template?.body !== 'string') {
            throw new Error(`Couldn't load template ${this.id}`);
        }
        this.data = Buffer.from(response.template.body);
        console.log(`Done loading template ${this.id}`)
        return this.data;
    }


    async setLabel(label: string, client?: RewstClient): Promise<void> {
        this.label = label;

        if (!client) {
            const message = `Only updating locally`;
            vscode.window.showWarningMessage(message);
            console.log(message);
            return;
        }

        const payload = {
            id: this.id,
            name: label
        };
        const response = await client.sdk.UpdateTemplateName(payload);
        if (response.updateTemplate?.name !== label) {
            const message = `failed to update template with new name ${label}`;
            vscode.window.showErrorMessage(message);
            console.log(message);
            throw new Error(message);
        }
    }

}