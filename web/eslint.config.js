import pluginVue from 'eslint-plugin-vue'
import vueTsEslintConfig from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default [
  {
    name: 'app/files-to-lint',
    files: ['**/*.ts', '**/*.vue']
  },
  {
    name: 'app/files-to-ignore',
    ignores: ['dist/**', 'node_modules/**']
  },
  ...pluginVue.configs['flat/essential'],
  ...vueTsEslintConfig(),
  skipFormatting,
  {
    name: 'app/coding-rules',
    rules: {
      // .rule/coding-rules.md: no trailing semicolons
      semi: ['error', 'never'],
      'no-extra-semi': 'error'
    }
  }
]
