import GenericCommand from "../models/GenericCommand.js";

export class RefreshView extends GenericCommand {
    commandName: string = 'RefreshView';

    async execute(): Promise<unknown> {
        this.cmdContext.view.refresh();
        console.log(`Refreshed View`);
        return;
    }

}