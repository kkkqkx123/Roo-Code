# AGENTS.md

## Build, Lint, and Test Commands

Use pnpm and Turbo for monorepo task orchestration:
- **Build**: `pnpm build` (Turbo builds all packages)
- **Lint**: `pnpm lint` (ESLint with max-warnings=0, no errors permitted)
- **Type check**: `pnpm check-types` (TypeScript strict mode)
- **Format**: `pnpm format` (Prettier with tabs, 4 spaces, print width 120)
- **Test all**: `pnpm test` (Vitest run mode)
- **Test single file**: `cd <package>; npx vitest run path/to/__tests__/File.spec.ts`

## Architecture and Structure

Monorepo using pnpm workspaces (Node 22.14.0, pnpm 10.8.1):
- **src/**: Main VSCode extension (TypeScript), contains services, core, api, integrations
- **packages/**: Shared libraries (@coder/types, @coder/cloud, @coder/core, @coder/ipc)
- **apps/**: Additional applications
- **webview-ui/**: React-based sidebar UI
- **Test setup**: Vitest (globals enabled), 20s timeout, mocks in src/__mocks__/

## Code Style Guidelines

- **Formatting**: Prettier (tabs, 4 spaces, 120 char width, semicolons off, bracket same line)
- **Imports**: ES6 modules with path aliases from tsconfig (vscode → src/__mocks__/vscode.js)
- **Naming**: camelCase for variables/functions, PascalCase for classes/types, UPPER_SNAKE_CASE for constants
- **Types**: Strict TypeScript enabled via config/typescript/base.json, use type imports
- **Error handling**: Try-catch with typed errors, console for debug (extends resolveVerbosity)
- **Testing**: Use vi.mock() for dependencies, spyOn for spying, expect() assertions, beforeEach hooks for setup
