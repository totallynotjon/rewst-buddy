import { TemplateBundleManager } from '@models';
import GenericCommand from '../GenericCommand';

export class BundleTemplates extends GenericCommand {
	commandName = 'BundleTemplates';

	async execute(): Promise<void> {
		await TemplateBundleManager.buildBundles();
	}
}
