import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
	schema: 'src/sessions/graphql/schema.graphql',
	documents: ['src/**/*.graphql', '!src/sessions/graphql/schema.graphql'],
	generates: {
		'src/sessions/graphql/generated/': {
			preset: 'client',
			presetConfig: {
				fragmentMasking: false,
			},
		},
	},
	emitLegacyCommonJSImports: false,
};

export default config;
