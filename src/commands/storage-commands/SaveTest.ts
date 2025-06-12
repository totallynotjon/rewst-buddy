import PersistentStorage from "PersistentStorage/RewstOrgData.js";
import GenericCommand from "../models/GenericCommand.js";
import { uuidv7 } from "uuidv7";

export class SaveTest extends GenericCommand {
    commandName: string = 'SaveTest';

    async execute(): Promise<unknown> {
        const rand = uuidv7();
        await this.cmdContext.context.globalState.update("test", rand);
        console.log(`saving ${rand}`);
        return;
    }
}