import RewstSession from '@client';
import { log } from '@log';
import { Org } from '@models';
import vscode, { QuickPickItem } from 'vscode';
import { pickSession } from './SessionPicker';

interface OrgItem extends QuickPickItem {
	org: Org;
}

export interface OrgPick {
	session: RewstSession,
	org: Org
}

export async function pickOrganization(session: RewstSession | undefined): Promise<OrgPick | undefined> {

	if (!session)
		session = await pickSession();
	if (!session) return undefined;


	const picked = await vscode.window.showQuickPick([
		{ 'label': session.profile.org.name, detail: "Primary Organization", arguments: [true] },
		{ 'label': 'Other Organization', arguments: [false] }

	], {
		placeHolder: 'Select an organization',
	});

	if (picked === undefined) {
		log.trace(`Backed out`);
		return undefined;
	}

	if (picked.arguments[0]) {
		log.trace(`Picked main org`)
		return {
			session: session,
			org: session.profile.org
		}
	}

	log.trace(`Selected sub org`);


	// Include the main org + managed orgs
	const orgs: OrgItem[] = session.profile.allManagedOrgs.map(o => ({
		label: o.name,
		org: o
	}));

	const subOrgPicked = await vscode.window.showQuickPick(orgs, {
		placeHolder: 'Select an organization',
	});


	if (subOrgPicked === undefined) {
		log.trace(`Backed out of suborg selection`);
		return undefined;
	}

	return {
		session: session,
		org: (subOrgPicked as OrgItem).org
	};
}
