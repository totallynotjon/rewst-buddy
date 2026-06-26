import { WorkingScopeManager } from '@models';
import { log } from '@utils';
import GenericCommand from '../GenericCommand';

/** Clears the working scope (orgs and workflows), reverting to no pin. */
export class ClearWorkingScope extends GenericCommand {
	commandName = 'ClearWorkingScope';

	async execute(): Promise<void> {
		WorkingScopeManager.clear();
		log.notifyInfo('Working scope cleared. With nothing pinned, writes are blocked until you set a scope.');
	}
}
