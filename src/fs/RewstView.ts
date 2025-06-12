
import * as vscode from 'vscode';
import RewstFS from './RewstFS.js';
import Entry, { Directory, ReadonlyDirectory } from './models/Entry.js';
import { Template } from './models/Template.js';
import RewstClient from 'rewst-client/RewstClient.js';
import Org from './models/Org.js';
import { Dir } from 'fs';
import RewstDragAndDropController from './RewstDragAndDropController.js';


export default class RewstView implements vscode.TreeDataProvider<Entry> {

    public rewstfs: RewstFS = new RewstFS();

    constructor(private context: vscode.ExtensionContext) {

        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider(RewstFS.scheme, this.rewstfs, { isCaseSensitive: true })
        );
        vscode.window.createTreeView('RewstView', {
            treeDataProvider: this,
            dragAndDropController: new RewstDragAndDropController(this.rewstfs),
        });

    }

    public addSampleData() {
        const template = new Template('tem', "Templ");
        template.ext = 'ps1';
        template.data = Buffer.from('- just: write something');

        const dir = new ReadonlyDirectory("dir1", "Dir1")
        dir.addViewContext("has-templates has-templatefolders")
        dir.addChild(template);
        dir.addChild(new Directory('dir2', "Dir 2"))


        this.rewstfs.tree.insertEntry(dir);
    }

    //#region treedata
    private _onDidChangeTreeData: vscode.EventEmitter<Entry | undefined | null | void> = new vscode.EventEmitter<Entry | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<Entry | undefined | null | void> = this._onDidChangeTreeData.event;

    public refresh(item?: Entry): void {
        this._onDidChangeTreeData.fire(item);
    }

    getTreeItem(element: Entry): vscode.TreeItem {
        if (element instanceof Template) {
            const template: Template = element;
            return {
                ...template,
                resourceUri: template.getUri(),
                command: template.getCommand()
            }
        }
        return {
            ...element,
            resourceUri: element.getUri(),
        };
    }

    getChildren(element?: Entry | undefined): vscode.ProviderResult<Entry[]> {
        if (element === undefined) {
            element = this.rewstfs.tree.root;
        }

        if (!(element instanceof Directory)) {
            return element.children;
        }

        return element.children.sort(((a: Entry, b: Entry) => {
            let score = a.label.localeCompare(b.label);
            score -= (a instanceof Directory) ? 100 : 0;
            score += (b instanceof Directory) ? 100 : 0;
            return score;
        }));
    }
    getParent?(element: Entry): vscode.ProviderResult<Entry> {
        console.log(`getParent ${element}`);
        return element.parent;
    }

    public async initializeClient(client: RewstClient): Promise<void> {
        console.log(`Initializing client`);
        const response = await client.sdk.UserOrganization();
        const org = response.userOrganization;


        if (org?.name === undefined) {
            throw new Error(`Org has an undefined name? ${org}`);
        }

        if (typeof org?.id !== 'string') {
            throw new Error(`Org has an undefined id? ${org}`);
        }

        const orgEntry: Org = new Org(org?.id, org?.name, client);
        orgEntry.initializeTemplates(this.context).then(
            () => {
                this.rewstfs.tree.insertEntry(orgEntry);
                this.refresh();
            }
        );
    }


    //#endregion

}