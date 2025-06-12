import RewstClient from "rewst-client/RewstClient.js";
import GenericCommand from "../models/GenericCommand.js";
import * as vscode from 'vscode';
import Entry from "@fs/models/Entry.js";

export class CopyId extends GenericCommand {
    commandName: string = 'CopyId';
    async execute(...args : any): Promise<void> {
        const entry = args[0][0] ?? undefined;

        if(!(entry instanceof Entry)) { 
            const message : string = "Cannot copy id of that";
            vscode.window.showErrorMessage(message);
            throw new Error(message);
        }
        await vscode.env.clipboard.writeText(entry.id);
        vscode.window.showInformationMessage('Text copied to clipboard!');

    }
}



