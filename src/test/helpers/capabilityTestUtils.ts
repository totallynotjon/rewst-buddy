import type { Capability, CapabilityContext } from '@capabilities';
import type { Session } from '@sessions';

export interface RawGraphqlCall {
	query: string;
	variables: Record<string, unknown>;
}

export function fakeCapabilityContext(response: unknown): {
	ctx: CapabilityContext;
	calls: RawGraphqlCall[];
	session: Session;
} {
	const calls: RawGraphqlCall[] = [];
	const session = {
		rawGraphql: async (query: string, variables: Record<string, unknown>) => {
			calls.push({ query, variables });
			return response as { data?: unknown; errors?: unknown };
		},
	} as unknown as Session;
	const ctx: CapabilityContext = { session, orgId: 'org-1', sessions: [session] };
	return { ctx, calls, session };
}

export function findTestCapability(capabilities: readonly Capability[], name: string): Capability {
	const capability = capabilities.find(x => x.spec.name === name);
	if (!capability) throw new Error('missing ' + name);
	return capability;
}

export function createCapabilityTestHarness(capabilities: readonly Capability[]): {
	fakeCtx: typeof fakeCapabilityContext;
	cap: (name: string) => Capability;
} {
	return {
		fakeCtx: fakeCapabilityContext,
		cap: (name: string) => findTestCapability(capabilities, name),
	};
}
