import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * Manual-only config for refreshing the committed schema snapshot.
 * Run: npm run codegen:refresh-schema
 *
 * This hits the live API and overwrites src/sessions/graphql/schema.graphql.
 * The main `codegen` script uses the committed snapshot (offline, reproducible).
 */
const config: CodegenConfig = {
	schema: 'https://api.rewst.io/graphql',
	generates: {
		'src/sessions/graphql/schema.graphql': {
			plugins: ['schema-ast'],
		},
	},
};

export default config;
