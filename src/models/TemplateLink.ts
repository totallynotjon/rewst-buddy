import { SessionProfile, TemplateFragment } from '@sessions';

export default interface TemplateLink {
	sessionProfile: SessionProfile;
	template: TemplateFragment;
	uriString: string;
}
