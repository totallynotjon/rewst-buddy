import type { ToolSpec } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { asString, requireString, asPositiveInt, ORG_ID_PROP } from './inputHelpers';

const MAX_INTEGRATIONS_LIMIT = 200;

function optionalString(value: unknown): string | undefined {
	return asString({ value }, 'value');
}

const listInstalledPacksSpec: ToolSpec = {
	name: 'buddy_list_installed_packs',
	args: '{"orgId": string}',
	description:
		'List the integration packs and bundles installed in one Rewst organization (id, name, ref, isBundle, status, packType).',
	inputSchema: { type: 'object', properties: { ...ORG_ID_PROP }, required: ['orgId'] },
};

const getPackAuthStatusSpec: ToolSpec = {
	name: 'buddy_get_pack_auth_status',
	args: '{"orgId": string, "packName": string}',
	description:
		"Check whether a pack needs OAuth setup in one Rewst organization. packName is a pack ref (e.g. microsoft_graph). Returns 'configured' when already authenticated, or the setup URL when authorization is needed.",
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			packName: { type: 'string', description: 'A pack ref, e.g. microsoft_graph' },
		},
		required: ['orgId', 'packName'],
	},
};

const listPackConfigsSpec: ToolSpec = {
	name: 'buddy_list_pack_configs',
	args: '{"orgId": string}',
	description:
		'List the pack (integration) configurations for one Rewst organization (id, name, packId, default). Returns all configs (this field has no pagination).',
	inputSchema: { type: 'object', properties: { ...ORG_ID_PROP }, required: ['orgId'] },
};

const listIntegrationsSpec: ToolSpec = {
	name: 'buddy_list_integrations',
	args: '{"orgId": string, "limit"?: number}',
	description:
		'List integrations available on the Rewst platform (name, description, numInstalled). Global catalog; the orgId only selects which signed-in session to use.',
	inputSchema: {
		type: 'object',
		properties: {
			...ORG_ID_PROP,
			limit: { type: 'number', description: 'Max integrations to return (default 50, max 200).' },
		},
		required: ['orgId'],
	},
};

async function runListInstalledPacks(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const QUERY = `query RewstBuddyMcpInstalledPacks($orgId: ID!) {
  packsAndBundlesByInstalledState(orgId: $orgId) {
    installedPacksAndBundles {
      id
      name
      ref
      isBundle
      status
      packType
    }
  }
}`;
	const orgId = requireString(input, 'orgId');
	const variables = { orgId };
	const { data, errors } = await ctx.session.rawGraphql(QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const installedPacksAndBundles = ((
		data as
			| {
					packsAndBundlesByInstalledState?: { installedPacksAndBundles?: unknown[] | null } | null;
			  }
			| undefined
	)?.packsAndBundlesByInstalledState?.installedPacksAndBundles ?? []) as {
		id?: string | null;
		name?: string | null;
		ref?: string | null;
		isBundle?: boolean | null;
		status?: string | null;
		packType?: string | null;
	}[];
	return installedPacksAndBundles
		.map(pack => {
			const name = optionalString(pack.name) ?? '(unnamed)';
			const refOrId = optionalString(pack.ref) ?? optionalString(pack.id) ?? 'unknown';
			const status = optionalString(pack.status);
			return `${name} (${refOrId})${pack.isBundle ? ' [bundle]' : ''}${status ? ' — ' + status : ''}`;
		})
		.join('\n');
}

async function runGetPackAuthStatus(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const QUERY = `query RewstBuddyMcpPackAuthUrl($orgId: ID!, $packName: String!) {
  packAuthUrl(packName: $packName, orgId: $orgId)
}`;
	const orgId = requireString(input, 'orgId');
	const packName = requireString(input, 'packName');
	const variables = { orgId, packName };
	const { data, errors } = await ctx.session.rawGraphql(QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const url = (data as { packAuthUrl?: unknown } | undefined)?.packAuthUrl;
	if (url == null) return 'configured (no auth URL needed)';
	return `needs setup: ${url}`;
}

async function runListPackConfigs(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const QUERY = `query RewstBuddyMcpPackConfigs($orgId: ID!) {
  packConfigs(where: { orgId: $orgId }) {
    id
    name
    packId
    default
    createdAt
  }
}`;
	const orgId = requireString(input, 'orgId');
	const variables = { orgId };
	const { data, errors } = await ctx.session.rawGraphql(QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const packConfigs = ((data as { packConfigs?: unknown[] | null } | undefined)?.packConfigs ?? []) as {
		id?: string | null;
		name?: string | null;
		packId?: string | null;
		default?: boolean | null;
		createdAt?: string | null;
	}[];
	return packConfigs
		.map(config => {
			const name = optionalString(config.name) ?? '(unnamed)';
			const id = optionalString(config.id) ?? 'unknown';
			const packId = optionalString(config.packId) ?? 'unknown';
			return `${name} (${id}) — pack ${packId}${config['default'] ? ' [default]' : ''}`;
		})
		.join('\n');
}

async function runListIntegrations(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const QUERY = `query RewstBuddyMcpIntegrations($limit: Int) {
  integrations(limit: $limit) {
    name
    description
    numInstalled
    isPublic
  }
}`;
	requireString(input, 'orgId');
	const limit = Math.min(asPositiveInt(input, 'limit') ?? 50, MAX_INTEGRATIONS_LIMIT);
	const variables = { limit };
	const { data, errors } = await ctx.session.rawGraphql(QUERY, variables);
	if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
		throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
	}
	const integrations = ((data as { integrations?: unknown[] | null } | undefined)?.integrations ?? []) as {
		name?: string | null;
		description?: string | null;
		numInstalled?: number | null;
		isPublic?: boolean | null;
	}[];
	return integrations
		.map(integration => {
			const name = optionalString(integration.name) ?? '(unnamed)';
			const description = optionalString(integration.description);
			return `${name}${integration.numInstalled != null ? ' (' + integration.numInstalled + ' installed)' : ''}${
				description ? ' — ' + description : ''
			}`;
		})
		.join('\n');
}

export const PACK_INTEGRATION_CAPABILITIES: Capability[] = [
	{ spec: listInstalledPacksSpec, access: 'read', chat: false, mcp: true, run: runListInstalledPacks },
	{ spec: getPackAuthStatusSpec, access: 'read', chat: false, mcp: true, run: runGetPackAuthStatus },
	{ spec: listPackConfigsSpec, access: 'read', chat: false, mcp: true, run: runListPackConfigs },
	{ spec: listIntegrationsSpec, access: 'read', chat: false, mcp: true, run: runListIntegrations },
];
