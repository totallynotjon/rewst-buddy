import GenericCommand from "../models/GenericCommand.js";
import RewstClient from '../../rewst-client/RewstClient.js';

export class NewClient extends GenericCommand {
    commandName: string = "NewClient";

    async execute(...args: unknown[]) {
        RewstClient.create(this.context).then(client => 
            this.cmdContext.view.initializeClient(client)
        );

    }

}