import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// 类型感知的 lint 是这里的重点：Wails 调用全是 Promise，
// 漏掉 await 只会表现为「界面没反应」，必须在静态检查阶段拦住。
export default tseslint.config(
  {
    // bindings 由 Wails CLI 生成，改它没有意义。
    ignores: ['dist/**', 'bindings/**', 'coverage/**', 'eslint.config.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      // React 事件处理器天然返回 Promise，逐处补 void 只会制造噪音。
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      // 生成绑定位于 frontend/bindings，服务层用 ../../bindings 引用；
      // 再深一层说明应该改用 @/ 别名。
      'no-restricted-imports': ['error', { patterns: ['../../../*'] }],
      // 界面文案里的 U+3000 全角空格是排版的一部分，不是笔误。
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipTemplates: true, skipRegExps: true },
      ],
      'jsx-a11y/label-has-associated-control': [
        'error',
        { assert: 'either', depth: 3 },
      ],
    },
  },
  {
    files: ['vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
