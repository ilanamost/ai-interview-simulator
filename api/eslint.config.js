import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default [
  {
    name: 'app/files-to-lint',
    files: ['**/*.ts']
  },
  {
    name: 'app/files-to-ignore',
    ignores: ['dist/**', 'node_modules/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    name: 'app/coding-rules',
    rules: {
      // .rule/coding-rules.md: no trailing semicolons
      semi: ['error', 'never'],
      'no-extra-semi': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
]
