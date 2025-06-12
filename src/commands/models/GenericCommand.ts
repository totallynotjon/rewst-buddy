import * as vscode from 'vscode';
import RewstFS from "@fs/RewstFS.js";
import RewstView from "@fs/RewstView.js";
import PersistentStorage from 'PersistentStorage/RewstOrgData.js';

export interface CommandContext {
    context: vscode.ExtensionContext,
    commandPrefix: string,
    fs: RewstFS;
    view: RewstView;
    storage: PersistentStorage;
}

export default abstract class GenericCommand {
    abstract commandName: string;
    context: vscode.ExtensionContext;
    secrets: vscode.SecretStorage;

    constructor(public cmdContext: CommandContext) {
        this.context = cmdContext.context;
        this.secrets = this.context.secrets;
    }

    abstract execute(...args: unknown[]): Promise<unknown>;
}

//allow generic instantiation of classes that extend this base
export function createCommand<T extends GenericCommand>(
    ctor: new (...args: any[]) => T,
    ...args: any[]
): T {
    return new ctor(...args);
}


