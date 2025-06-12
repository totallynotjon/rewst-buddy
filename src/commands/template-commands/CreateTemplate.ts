import RewstClient from "rewst-client/RewstClient.js";
import GenericCommand from "../models/GenericCommand.js";
import * as vscode from 'vscode';
import { Template } from "@fs/models/Template.js";
import { Directory } from "@fs/models/Entry.js";


export class CreateTemplate extends GenericCommand {
    commandName: string = 'CreateTemplate';

    async execute(...args: any): Promise<void> {
        const entry = args[0][0] ?? undefined;

        if (!(entry instanceof Directory)) {
            const message: string = "Cannot create template in something that is not a folder";
            vscode.window.showErrorMessage(message);
            throw new Error(message);
        }

        const label = await vscode.window.showInputBox({
            placeHolder: 'Template Name',
            prompt: 'Enter a name for the template'
        });


        if (!label) {
            console.log("No label provided, exiting Template Creation");
            return;
        }

        const template = await this.cmdContext.fs.createTemplate(entry, label);
        vscode.commands.executeCommand('rewst-buddy.RefreshView', template);
        vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', template);

    }
}



