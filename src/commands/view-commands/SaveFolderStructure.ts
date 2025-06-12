import RewstClient from "rewst-client/RewstClient.js";
import GenericCommand from "../models/GenericCommand.js";
import * as vscode from 'vscode';
import Entry, { Directory } from "@fs/models/Entry.js";
import { Template } from "@fs/models/Template.js";

export class SaveFolderStructure extends GenericCommand {
    commandName: string = 'SaveFolderStructure';
    async execute(...args: any): Promise<unknown> {

        const entry = args[0][0] ?? undefined;

        if (entry instanceof Entry) {
            const org = this.cmdContext.fs.lookupOrg(entry)
            const structure = org.getTemplateFolderStructure();

            const data = this.cmdContext.storage.getRewstOrgData(org.id);
            data.label = org.label
            data.templateFolderStructure = structure;
            this.cmdContext.storage.setRewstOrgData(data);

            return structure;
        }

        return true;
    }
}



