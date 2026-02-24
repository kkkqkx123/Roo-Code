# AGENTS.md

## Build, Lint, and Test Commands

Use pnpm and Turbo for monorepo task orchestration:
- **Build**: `pnpm build` (Turbo builds all packages)
- **Lint**: `pnpm lint` (ESLint with max-warnings=0, no errors permitted)
- **Type check**: `pnpm check-types` (TypeScript strict mode)
- **Test file/path**: `cd src; npx vitest run utils\logging\__tests__`

## Architecture and Structure

Monorepo using pnpm workspaces (Node 22.14.0, pnpm 10.8.1):
- **src/**: Main VSCode extension (TypeScript), contains services, core, api, integrations
- **packages/**: Shared libraries (@coder/types, @coder/cloud, @coder/core, @coder/ipc)
- **apps/**: Additional applications
- **webview-ui/**: React-based sidebar UI
- **Test setup**: Vitest (globals enabled), 20s timeout, mocks in src/__mocks__/

## Code Style Guidelines

- **Imports**: ES6 modules with path aliases from tsconfig (vscode → src/__mocks__/vscode.js)
- **Naming**: camelCase for variables/functions, PascalCase for classes/types, UPPER_SNAKE_CASE for constants
- **Types**: Strict TypeScript enabled via config/typescript/base.json, use type imports
- **Error handling**: Try-catch with typed errors, console for debug (extends resolveVerbosity)
- **Testing**: Use vi.mock() for dependencies, spyOn for spying, expect() assertions, beforeEach hooks for setup
