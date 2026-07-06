import { resolveConflictChoice } from '@models';
import GenericCommand from '../../GenericCommand';

/** Bound to the "Keep Local" button on the conflict diff's editor toolbar. */
export class KeepLocalConflict extends GenericCommand {
	commandName = 'KeepLocalConflict';

	async execute(): Promise<void> {
		resolveConflictChoice('Keep Local');
	}
}
