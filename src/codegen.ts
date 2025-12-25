import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
	schema: 'https://api.rewst.io/graphql',
	documents: ['src/**/*.graphql'],
	generates: {
		'src/graphql_sdk.ts': {
			plugins: ['typescript', 'typescript-operations', 'typescript-graphql-request'],
			config: {
				gqlImport: 'graphql-request#gql',
			},
		},
	},
	emitLegacyCommonJSImports: false,
};

export default config;
