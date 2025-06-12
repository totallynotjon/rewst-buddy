import PersistentStorage from "PersistentStorage/RewstOrgData.js";
import GenericCommand from "../models/GenericCommand.js";
import { uuidv7 } from "uuidv7";

export class ReadTest extends GenericCommand {
    commandName: string = 'ReadTest';

    async execute(): Promise<unknown> {
        const val = this.cmdContext.context.globalState.get("test");
        console.log(`reading ${val}`);

        const orgData = this.cmdContext.storage.getAllOrgData();
        console.log(orgData);
        return;
    }
}