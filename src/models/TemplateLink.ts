import { RewstSessionProfile } from '@sessions';
import { TemplateFragment } from 'sessions/graphql/sdk';

export default interface TemplateLink {
	sessionProfile: RewstSessionProfile;
	template: TemplateFragment;
	uriString: string;
}
