import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "out/**",
      "node_modules/**",
      "*.mjs",
      "*.vsix",
      "src/types/**",
      "test/smoke/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
    },
  },
);
