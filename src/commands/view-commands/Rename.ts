import RewstClient from "rewst-client/RewstClient.js";
import GenericCommand from "../models/GenericCommand.js";
import * as vscode from 'vscode';
import Entry, { Directory } from "@fs/models/Entry.js";
import { Template } from "@fs/models/Template.js";

export class Rename extends GenericCommand {
    commandName: string = 'Rename';
    async execute(...args: any): Promise<unknown> {

        const entry = args[0][0] ?? undefined;
        console.log(`Rename`);
        console.log(entry);

        if (entry instanceof Template) {
            console.log("Processing a Template")
        } else if (entry instanceof Directory) {
            console.log("Processing a Directory")
        } else {
            console.log("Not instance of detected type")
        }

        const label = await vscode.window.showInputBox({
            placeHolder: entry.label,
            prompt: 'Enter a new name for the item',
            validateInput: (v) => {
                return entry.isValidLabel(v)
                    ? undefined
                    : 'Please use alpha-numerics or []-'
            }
        });

        console.log(`new label ${label}`)
        if (label) {
            const org = this.cmdContext.fs.lookupOrg(entry) ?? undefined;
            await entry.setLabel(label, org.rewstClient);
        }

        vscode.commands.executeCommand('rewst-buddy.RefreshView');
        vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', entry);
        return true;
    }
}



