import * as vscode from 'vscode';
import Entry from "./Entry.js";
import RewstFS from '../RewstFS.js';

interface ITree<T extends Entry> {
    lookupEntry(uri: vscode.Uri): Entry | undefined;
    insertEntry(t: T): void;
    removeEntry(uri: vscode.Uri): void;
}

export default class Tree implements ITree<Entry> {
    constructor(public root: Entry) { }

    lookupEntry(uri: vscode.Uri): Entry | undefined {
        const sUri = uri.toString();
        if (sUri == this.root.getUri.toString()) {
            return this.root;
        }

        const parts = Entry.getUriParts(uri);
        let cur = this.root;
        for (const part of parts) {
            const match = cur.children.filter(c => (c.id === part) || (sUri === c.getUri().toString()));
            if (match.length !== 1) {
                return undefined;
            }
            cur = match[0];
        }
        return cur;
    }

    insertEntry(entry: Entry, parentUri?: vscode.Uri): void {

        if (parentUri === undefined) {
            this.root.addChild(entry);
            return;
        }

        const parent = this.lookupEntry(parentUri);

        if (parent === undefined) {
            throw new Error(`Parent with uri '${parentUri}' could not be found`);
        } else {
            parent.addChild(entry);
        }

    }

    removeEntry(uri: vscode.Uri): void {
        throw new Error("Method not implemented.");
    }

}
