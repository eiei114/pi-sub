module.exports = {
	root: true,
	env: {
		node: true,
		es2022: true,
	},
	parser: "@typescript-eslint/parser",
	parserOptions: {
		ecmaVersion: 2022,
		sourceType: "module",
	},
	plugins: ["@typescript-eslint"],
	extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
	ignorePatterns: ["node_modules", "coverage", "dist"],
	rules: {
		// Terminal UI code intentionally matches ANSI escape sequences.
		"no-control-regex": "off",
		// Polling loops use intentional while (true) with internal breaks.
		"no-constant-condition": "off",
		"@typescript-eslint/no-unused-vars": [
			"error",
			{
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
				caughtErrorsIgnorePattern: "^_",
			},
		],
	},
	overrides: [
		{
			files: ["**/*.test.ts", "**/test/**/*.ts"],
			rules: {
				"@typescript-eslint/no-explicit-any": "off",
			},
		},
		{
			files: ["**/settings-types.ts"],
			rules: {
				// Branded string unions use `(string & {})` for autocomplete.
				"@typescript-eslint/ban-types": "off",
			},
		},
	],
};
