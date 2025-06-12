import RewstClient from "../../rewst-client/RewstClient.js";
import { uuidv7 } from "uuidv7";
import { Template } from "./Template.js";
import Entry, { Directory, ReadonlyDirectory, TemplateDirectory } from "./Entry.js";
import FolderStructure from "./FolderStructure.js";
import PersistentStorage from "PersistentStorage/RewstOrgData.js";
import * as vscode from 'vscode';


export default class Org extends ReadonlyDirectory {
    constructor(id: string, label: string, public rewstClient: RewstClient) {
        super(id, label);
    }

    templatesFolder: ReadonlyDirectory = new ReadonlyDirectory(uuidv7(), "Templates");
    children = [this.templatesFolder]

    getTemplateMap(): Map<string, Template> {
        const templates = new Map<string, Template>();

        let queue: Entry[] = [...this.templatesFolder.children];

        while (queue.length) {
            const top = queue.shift();
            if (top instanceof Template) {
                templates.set(top.id, top);
            } else if (top instanceof Directory) {
                queue.push(...top.children);
            }
        }

        return templates;

    }

    async initializeTemplates(context: vscode.ExtensionContext) {

        this.templatesFolder.addViewContext("has-templates");
        this.templatesFolder.addViewContext("has-templatefolders");

        const response = await this.rewstClient.sdk.listTemplatesMinimal({ "orgId": this.id });
        let templates = response.templates;


        templates.forEach((template: { id: string; name: string; }) => {
            new Template(template.id, template.name).moveTo(this.templatesFolder)
        });

        this.addChild(this.templatesFolder);
        this.fullMimicStructure(context);
    }

    fullMimicStructure(context: vscode.ExtensionContext) {
        const pstorage = new PersistentStorage(context)
        const data = pstorage.getRewstOrgData(this.id);
        const templateMap = this.getTemplateMap();

        if (data.templateFolderStructure) {
            const structure = data.templateFolderStructure;
            this.templatesFolder.id = structure.id;
            Org.mimicStructure(templateMap, structure, this.templatesFolder);
        }
    }

    private static mimicStructure(templateMap: Map<string, Template>, structure: FolderStructure, parent: Entry) {
        for (const child of structure.children || []) {
            if (child.children?.length) { //this is a folder
                const newFolder = new TemplateDirectory(child.id, child.label);
                newFolder.moveTo(parent);
                this.mimicStructure(templateMap, child, newFolder);
            } else { //this is a template
                const template = templateMap.get(child.id);
                if (template) {
                    template.moveTo(parent);
                    template.ext = child.ext
                }
            }
        }
    }

    getTemplateFolderStructure(): FolderStructure {
        const templatesfolder = this.templatesFolder;
        const structure = templatesfolder.getStructure();
        if (structure == undefined) {
            const message = "Failed to save folder structure"
            vscode.window.showErrorMessage(message);
            console.log(message);
            throw new Error(message);
        }
        return structure;
    }
}
