import RewstClient from "rewst-client/RewstClient.js";
import GenericCommand from "../models/GenericCommand.js";
import * as vscode from 'vscode';
import { Template } from "@fs/models/Template.js";

export class ChangeTemplateFiletypePowershell extends GenericCommand {
    commandName: string = 'ChangeTemplateFiletypePowershell';
    async execute(...args: any): Promise<void> {
        const entry = args[0][0] ?? undefined;

        entry.ext = 'ps1';
        vscode.commands.executeCommand('rewst-buddy.RefreshView', entry);
        vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', entry);
        return;
    }
}

export class ChangeTemplateFiletypeHTML extends GenericCommand {
    commandName: string = 'ChangeTemplateFiletypeHTML';
    async execute(...args: any): Promise<void> {
        const entry = args[0][0] ?? undefined;

        entry.ext = 'html';
        vscode.commands.executeCommand('rewst-buddy.RefreshView', entry);
        vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', entry);
        return;
    }
}

export class ChangeTemplateFiletypeYAML extends GenericCommand {
    commandName: string = 'ChangeTemplateFiletypeYAML';
    async execute(...args: any): Promise<void> {
        const entry = args[0][0] ?? undefined;

        entry.ext = 'yml';
        vscode.commands.executeCommand('rewst-buddy.RefreshView', entry);
        vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', entry);
        return;
    }
}

export class ChangeTemplateFiletypeCustom extends GenericCommand {
    commandName: string = 'ChangeTemplateFiletypeCustom';
    async execute(...args: any): Promise<void> {
        const entry = args[0][0] ?? undefined;

        if (!(entry instanceof Template)) {

            return;
        }

        const ext = await vscode.window.showInputBox({
            placeHolder: 'ps1',
            prompt: 'Enter an extension (ex: html)',
            validateInput: (input) => {
                return /^[a-zA-Z0-9 ]*$/.test(input)
                    ? undefined
                    : 'Please use alpha-numerics'
            }
        });

        if (ext) {
            entry.ext = ext;
        }

        vscode.commands.executeCommand('rewst-buddy.RefreshView', entry);
        vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', entry);

        return;
    }
}


