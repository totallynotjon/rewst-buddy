import * as vscode from 'vscode';
import Entry, { Directory } from './models/Entry.js';
import { CommandContext } from '@commands/models/GenericCommand.js';
import RewstFS from './RewstFS.js';

export default class RewstDragAndDropController implements vscode.TreeDragAndDropController<Entry> {
    dropMimeTypes = ['application/vnd.code.tree.RewstView'];
    dragMimeTypes = ['text/uri-list'];
    constructor(public fs: RewstFS) {

    }
    handleDrag?(source: readonly Entry[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Thenable<void> | void {

        dataTransfer.set('text/uri-list', new vscode.DataTransferItem(JSON.stringify(source.map(s => s.getUri().toString()))));
        console.log(`Dropped onto ${source}`);
    }
    async handleDrop?(target: Entry | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {

        if (!(target instanceof Directory)) {
            throw new Error("Can't move into not folder");
        }

        const data = dataTransfer.get('text/uri-list');
        if (!data) {
            throw new Error("Nothing dropped");
        }

        const uriStrings: string[] = JSON.parse(await data.asString());
        const uris = uriStrings.map(s => vscode.Uri.parse(s));

        for (const uri of uris) {
            this.fs.move(uri, target.getUri());
        }

        vscode.commands.executeCommand('rewst-buddy.RefreshView');
        vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', target);
    }

}