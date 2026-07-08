import { Session } from '@sessions';
import { pickOrganization } from '@ui';
import { log } from '@utils';
import vscode from 'vscode';
import { rawGraphqlOrThrow } from '../../capabilities/inputHelpers';
import {
	buildUnpackInput,
	CRATE_DETAIL_QUERY,
	CRATE_LIST_QUERY,
	isValueToken,
	parseCrateDetail,
	tokenDefault,
	type CrateDetail,
	type CrateTokenDetail,
	type TokenValues,
} from '../../crates/crateUnpack';
import { runUnpackCrate } from '../../crates/unpackClient';
import GenericCommand from '../GenericCommand';

/**
 * Install (unpack) a prebuilt Rewst Crate into an organization. The whole
 * configuration step is dynamic: the crate's own token metadata drives a
 * QuickPick/InputBox wizard — free-text tokens become input boxes (prefilled
 * with the crate's defaults), select tokens become option pickers, and
 * multiselect tokens allow picking several options — so any crate's option
 * set is handled without per-crate knowledge. Triggers install disabled by
 * default so nothing fires until reviewed in Rewst.
 */

export interface CrateListRow {
	id?: string | null;
	name?: string | null;
	category?: string | null;
	description?: string | null;
	isUnpackedForSelectedOrg?: boolean | null;
}

export interface CrateQuickPickItem extends vscode.QuickPickItem {
	crateId: string;
}

const CRATE_LIST_LIMIT = 500;

/**
 * Maps catalog rows to QuickPick items: rows without an id are dropped, and
 * already-installed crates carry a check icon and an "already installed" tag.
 */
export function crateQuickPickItems(crates: readonly CrateListRow[]): CrateQuickPickItem[] {
	return crates
		.filter((crate): crate is CrateListRow & { id: string } => typeof crate.id === 'string' && crate.id.length > 0)
		.map(crate => ({
			crateId: crate.id,
			label:
				crate.isUnpackedForSelectedOrg === true
					? `$(check) ${crate.name ?? crate.id}`
					: (crate.name ?? crate.id),
			description: [
				crate.category ?? undefined,
				crate.isUnpackedForSelectedOrg === true ? 'already installed' : undefined,
			]
				.filter(Boolean)
				.join(' — '),
			detail: crate.description ?? undefined,
		}));
}

async function pickCrate(session: Session, orgId: string): Promise<string | undefined> {
	const crates = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Loading Crate catalog…' },
		async () => {
			const data = await rawGraphqlOrThrow(session, CRATE_LIST_QUERY, { orgId, limit: CRATE_LIST_LIMIT });
			return (data as { crates?: CrateListRow[] | null } | undefined)?.crates ?? [];
		},
	);

	const items = crateQuickPickItems(crates);
	if (items.length === 0) {
		log.notifyInfo('No Crates are visible to this session.');
		return undefined;
	}

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a Crate to install',
		matchOnDescription: true,
		matchOnDetail: true,
	});
	return picked?.crateId;
}

/** Collects a value for one select token; undefined means the user backed out. */
export async function promptSelectToken(token: CrateTokenDetail): Promise<string | string[] | undefined> {
	const defaultValue = tokenDefault(token);
	const items = token.options
		.filter(option => option.value !== undefined)
		.map(option => ({
			label: option.label ?? option.value ?? '',
			description: option.isDefault === true ? 'default' : undefined,
			picked: token.isMultiselect === true && (option.isDefault === true || option.value === defaultValue),
			value: option.value as string,
		}));

	if (token.isMultiselect === true) {
		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: token.name ?? 'Select values',
			canPickMany: true,
		});
		return picked?.map(item => item.value);
	}

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: token.name ?? 'Select a value',
	});
	return picked?.value;
}

/** Collects a value for one free-text token; undefined means backed out. */
export async function promptInputToken(token: CrateTokenDetail): Promise<string | undefined> {
	return vscode.window.showInputBox({
		prompt: token.name,
		value: tokenDefault(token) ?? '',
		placeHolder: token.previewText ?? token.emptyLabel,
		ignoreFocusOut: true,
	});
}

/**
 * Walks the crate's value-bearing tokens in wizard order, prompting for each
 * (defaults prefilled). Returns undefined when the user cancels any step.
 */
export async function collectTokenValues(crate: CrateDetail): Promise<TokenValues | undefined> {
	const values: TokenValues = {};
	const valueTokens = crate.tokens.filter(token => isValueToken(token) && token.id !== undefined);
	for (const [position, token] of valueTokens.entries()) {
		const stepLabel = `(${position + 1}/${valueTokens.length})`;
		const named = { ...token, name: `${token.name ?? token.id} ${stepLabel}` };
		const value = token.options.length > 0 ? await promptSelectToken(named) : await promptInputToken(named);
		if (value === undefined) return undefined;
		values[token.id as string] = value;
	}
	return values;
}

export class InstallCrate extends GenericCommand {
	commandName = 'InstallCrate';

	async execute(): Promise<void> {
		const pick = await pickOrganization();
		if (!pick) return;
		const { session, org } = pick;

		const crateId = await pickCrate(session, org.id);
		if (crateId === undefined) return;

		const data = await rawGraphqlOrThrow(session, CRATE_DETAIL_QUERY, { crateId, orgId: org.id });
		const crate = parseCrateDetail(data);
		if (!crate) {
			log.notifyError(`Crate ${crateId} was not found or is not visible to this session.`);
			return;
		}

		const tokenValues = await collectTokenValues(crate);
		if (tokenValues === undefined) return;

		const workflowName = await vscode.window.showInputBox({
			prompt: 'Name for the unpacked workflow',
			// Same default the web unpack wizard offers: the crate's source workflow name.
			value: crate.workflowName ?? crate.name,
			ignoreFocusOut: true,
		});
		if (workflowName === undefined) return;

		let enableTriggers = false;
		if (crate.crateTriggers.length > 0) {
			const triggerChoice = await vscode.window.showQuickPick(
				[
					{ label: 'Install triggers disabled (recommended)', enabled: false },
					{ label: 'Install triggers enabled', enabled: true },
				],
				{ placeHolder: `This Crate installs ${crate.crateTriggers.length} trigger(s)` },
			);
			if (triggerChoice === undefined) return;
			enableTriggers = triggerChoice.enabled;
		}

		// Build the input before confirming so the preview shows exactly what will
		// run — including the resolved workflow name when the input box was cleared.
		const input = buildUnpackInput(crate, {
			orgId: org.id,
			workflowName: workflowName || undefined,
			tokenValues,
			enableTriggers,
		});

		const detailLines = [
			`Organization: ${org.name}`,
			`Workflow name: ${input.workflow.name}`,
			crate.crateTriggers.length > 0
				? `Triggers: ${crate.crateTriggers.length}, installed ${enableTriggers ? 'enabled' : 'disabled'}`
				: undefined,
			crate.requiredOrgVariables.length > 0
				? `Requires org variables: ${crate.requiredOrgVariables.join(', ')}`
				: undefined,
		].filter(Boolean);
		const confirmed = await vscode.window.showWarningMessage(
			`Install Crate "${crate.name}"?`,
			{ modal: true, detail: detailLines.join('\n') },
			'Install',
		);
		if (confirmed !== 'Install') return;

		let cancelled = false;
		try {
			const outcome = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Installing Crate "${crate.name}"…`,
					cancellable: true,
				},
				async (progress, token) => {
					const controller = new AbortController();
					const cancelListener = token.onCancellationRequested(() => {
						cancelled = true;
						controller.abort();
					});
					try {
						return await runUnpackCrate({
							session,
							input,
							signal: controller.signal,
							onProgress: label => progress.report({ message: label }),
						});
					} finally {
						cancelListener.dispose();
					}
				},
			);
			const suffix =
				crate.requiredOrgVariables.length > 0
					? ` Reminder — this Crate expects org variable(s): ${crate.requiredOrgVariables.join(', ')}.`
					: '';
			log.notifyInfo(
				`Installed Crate "${crate.name}" into ${org.name} as workflow "${input.workflow.name}"` +
					(outcome.id ? ` (${outcome.id})` : '') +
					`.${suffix}`,
			);
		} catch (error) {
			if (cancelled) {
				log.notifyInfo(
					`Cancelled installing Crate "${crate.name}". The unpack may have already started server-side — check the org in Rewst.`,
				);
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			log.notifyError(`Installing Crate "${crate.name}" failed: ${message}`);
		}
	}
}
