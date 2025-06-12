import RewstClient from "rewst-client/RewstClient.js";
import GenericCommand from "../models/GenericCommand.js";
import * as vscode from 'vscode';

export class ClearProfiles extends GenericCommand {
    commandName: string = 'ClearProfiles';

    async execute(): Promise<unknown> {
        RewstClient.clearProfiles(this.context);
        console.log(`Cleared profiles`);
        return true;
    }

}