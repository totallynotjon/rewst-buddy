import RewstClient from "rewst-client/RewstClient.js";
import GenericCommand from "../models/GenericCommand.js";
import * as vscode from 'vscode';
import { Directory } from "@fs/models/Entry.js";

export class CreateTemplateFolder extends GenericCommand {
    commandName: string = 'CreateTemplateFolder';
    async execute(...args: any): Promise<void> {
        const entry = args[0][0] ?? undefined;

        if (!(entry instanceof Directory)) {
            const message: string = "Cannot create folder in something that is not a folder";
            vscode.window.showErrorMessage(message);
            throw new Error(message);
        }

        const label = await vscode.window.showInputBox({
            placeHolder: 'Folder Name',
            prompt: 'Enter a name for the template'
        });


        if (!label) {
            console.log("No label provided, exiting Folder Creation");
            return;
        }

        const folder = await this.cmdContext.fs.createTemplateFolder(entry, label);

        vscode.commands.executeCommand('rewst-buddy.RefreshView', folder);
    }
}



