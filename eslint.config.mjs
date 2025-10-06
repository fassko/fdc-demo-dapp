import { FlatCompat } from '@eslint/eslintrc';
import eslintPluginImport from 'eslint-plugin-import';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  ...compat.extends('prettier'),
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      import: eslintPluginImport,
    },
    rules: {
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
          pathGroups: [
            {
              pattern: 'react',
              group: 'external',
              position: 'before',
            },
            {
              pattern: 'react-*',
              group: 'external',
              position: 'after',
            },
            {
              pattern: 'next*',
              group: 'external',
              position: 'after',
            },
            {
              pattern: '@next/*',
              group: 'external',
              position: 'after',
            },
            {
              pattern: '@/**',
              group: 'internal',
              position: 'after',
            },
            {
              pattern: '@flarenetwork/**',
              group: 'external',
              position: 'after',
            },
            {
              pattern: '@rainbow-me/**',
              group: 'external',
              position: 'after',
            },
            {
              pattern: '@radix-ui/**',
              group: 'external',
              position: 'after',
            },
            {
              pattern: '@tanstack/**',
              group: 'external',
              position: 'after',
            },
            {
              pattern: '@hookform/**',
              group: 'external',
              position: 'after',
            },
            {
              pattern: '@openzeppelin/**',
              group: 'external',
              position: 'after',
            },
            {
              pattern: 'wagmi',
              group: 'external',
              position: 'after',
            },
            {
              pattern: 'viem',
              group: 'external',
              position: 'after',
            },
            {
              pattern: 'xrpl',
              group: 'external',
              position: 'after',
            },
            {
              pattern: 'zod',
              group: 'external',
              position: 'after',
            },
          ],
          pathGroupsExcludedImportTypes: ['react'],
        },
      ],
    },
  },
  {
    ignores: ['src/types/truffle-types/**/*.d.ts'],
  },
];

export default eslintConfig;
