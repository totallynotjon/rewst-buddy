import GenericCommand from '../GenericCommand';

export class CreateTemplate extends GenericCommand {
	commandName = 'CreateTemplate';

	async execute(...args: unknown[]): Promise<void> {}
}
