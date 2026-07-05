import { resolveConflictChoice } from '@models';
import GenericCommand from '../../GenericCommand';

/** Bound to the "Take Remote" button on the conflict diff's editor toolbar. */
export class TakeRemoteConflict extends GenericCommand {
	commandName = 'TakeRemoteConflict';

	async execute(): Promise<void> {
		resolveConflictChoice('Take Remote');
	}
}
