import GenericCommand from "../models/GenericCommand.js";
import RewstClient from '../../rewst-client/RewstClient.js';
import Org from "@fs/models/Org.js";
import RewstFS from "fs/RewstFS.js";

export class LoadClients extends GenericCommand {
    commandName: string = "LoadClients";

    async execute(): Promise<unknown> {
        const view = this.cmdContext.view;

        const clients = await RewstClient.LoadClients(this.context);

        for (const client of clients) {
            view.initializeClient(client);
        }

        return;
    }

}