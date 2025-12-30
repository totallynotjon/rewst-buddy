import { RewstSessionProfile } from '@client';
import { TemplateFragment } from '@sdk';

export default interface TemplateLink {
	sessionProfile: RewstSessionProfile;
	template: TemplateFragment;
	uriString: string;
}
