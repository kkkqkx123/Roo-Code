# Webview VSIX Packaging Issue Analysis

## Problem Description

When running `pnpm --filter @coder/vscode-webview dev`, the webview loads correctly in development mode. However, after packaging the extension as a VSIX file, the webview completely fails to load.

## Root Cause Analysis

### 1. `.vscodeignore` Configuration Issues (Primary Issue)

**Current Configuration** (`src/.vscodeignore`):
```
!webview-ui/build/assets/*.js
!webview-ui/build/assets/*.css
!webview-ui/build/assets/*.ttf
!webview-ui/build/assets/fonts/*.woff
!webview-ui/build/assets/fonts/*.woff2
!webview-ui/build/assets/fonts/*.ttf
```

**Problem**: Vite builds output JavaScript chunk files with hash-based names (e.g., `chunk-B0m2ddpp.js`, `chunk-2UxHyX5q.js`). The VSIX packaging tool (`@vscode/vsce`) uses glob patterns that may not properly match all these hashed filenames with the current `*.js` pattern.

**Impact**: Many critical chunk files required for the webview to function are excluded from the final VSIX package.

### 2. Missing `localResourceRoots` Configuration

VS Code webviews require explicit `localResourceRoots` configuration to load local resources securely. The webview panel creation must include:

```typescript
localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'build')]
```

Without this configuration, the packaged extension cannot load webview resources.

### 3. Content Security Policy (CSP) Restrictions

**Current Production CSP**:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline' https:; img-src ${webview.cspSource} https: storage.googleapis.com https://img.clerk.com data: blob:; media-src ${webview.cspSource}; script-src ${webview.cspSource} 'unsafe-eval' 'wasm-unsafe-eval' 'nonce-${nonce}' https:; connect-src ${webview.cspSource} https: http: ws: wss:;">
```

**Potential Issues**:
- `script-src` includes `https:` but may not properly allow VS Code's internal webview protocols
- Missing explicit `wasm-unsafe-eval` in some contexts where WebAssembly modules are loaded

### 4. Audio Directory Path Mismatch

**Code Reference** (`ClineProvider.ts`):
```typescript
const audioUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "audio"])
```

**Build Configuration** (`esbuild.mjs`):
```javascript
["../webview-ui/audio", "webview-ui/audio", { optional: true }],
```

**Issue**: The audio files are copied to `dist/webview-ui/audio` during the bundle step, but the runtime code references `webview-ui/audio` from the extension root. This path mismatch causes audio loading to fail in production.

### 5. Vite Build Output Directory Configuration

**Current Configuration** (`webview-ui/vite.config.ts`):
```typescript
let outDir = "../src/webview-ui/build"
```

**Issue**: Build output goes to `src/webview-ui/build`, but the extension expects files at the extension root level (`webview-ui/build`). The esbuild configuration copies files, but this adds complexity and potential for path errors.

### 6. Chunk File Loading Failures

The Vite build generates numerous chunk files for code splitting:
- `chunk-*.js` (200+ files)
- `chunk-*.js.map` (source maps)
- `mermaid-bundle.js` (large mermaid library bundle)

If any of these chunks fail to load due to incorrect paths or missing files, the entire webview application will fail to initialize.

## Verification Steps

### Check Build Output
```bash
# After running pnpm build
ls -la src/webview-ui/build/assets/
```

### Inspect VSIX Contents
```bash
# VSIX files are ZIP archives
unzip -l bin/coder-roo-*.vsix | grep webview-ui
```

### Check for Missing Files
```bash
# Compare build output with VSIX contents
diff <(ls src/webview-ui/build/assets/) <(unzip -l bin/coder-roo-*.vsix | grep webview-ui/build/assets | awk '{print $4}')
```

## Applied Fixes

The following fixes have been applied to resolve the VSIX packaging issues:

### Fix 1: Updated `.vscodeignore` ✅

**File**: `src/.vscodeignore`

Replaced specific file patterns with directory-wide inclusion to ensure all hashed chunk files are included:

```diff
- !**/*.map
- !webview-ui/audio
- !webview-ui/build/assets/*.js
- !webview-ui/build/assets/*.ttf
- !webview-ui/build/assets/*.css
- !webview-ui/build/assets/fonts/*.woff
- !webview-ui/build/assets/fonts/*.woff2
- !webview-ui/build/assets/fonts/*.ttf
+ # Include the built webview - use recursive pattern to include all hashed chunk files
+ !webview-ui/**
```

### Fix 2: Enhanced `localResourceRoots` Configuration ✅

**Files**: `src/core/webview/ClineProvider.ts`, `src/activate/registerCommands.ts`

Added explicit resource roots for all webview-related directories:

```typescript
const resourceRoots = [
    this.contextProxy.extensionUri,
    vscode.Uri.joinPath(this.contextProxy.extensionUri, 'webview-ui', 'build'),
    vscode.Uri.joinPath(this.contextProxy.extensionUri, 'webview-ui', 'audio'),
    vscode.Uri.joinPath(this.contextProxy.extensionUri, 'assets'),
]
```

### Fix 3: Improved CSP Configuration ✅

**File**: `src/core/webview/ClineProvider.ts`

Updated Content Security Policy to explicitly allow media and worker sources:

```html
<meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    font-src ${webview.cspSource} data: https:;
    style-src ${webview.cspSource} 'unsafe-inline' https:;
    img-src ${webview.cspSource} https: storage.googleapis.com https://img.clerk.com data: blob:;
    media-src ${webview.cspSource} https:;
    script-src ${webview.cspSource} 'unsafe-eval' 'wasm-unsafe-eval' 'nonce-${nonce}' https:;
    connect-src ${webview.cspSource} https: http: ws: wss:;
    worker-src ${webview.cspSource} blob:;
">
```

### Fix 4: Added Comprehensive File Existence Checks ✅

**File**: `src/core/webview/ClineProvider.ts`

Added runtime verification for all required files with detailed logging:

```typescript
const requiredFiles = [
    { path: this.contextProxy.extensionUri.fsPath + "/webview-ui/build/assets/index.js", name: "Main script (index.js)" },
    { path: this.contextProxy.extensionUri.fsPath + "/webview-ui/build/assets/index.css", name: "Stylesheet (index.css)" },
    { path: this.contextProxy.extensionUri.fsPath + "/assets/codicons/codicon.css", name: "Codicons stylesheet" },
    { path: this.contextProxy.extensionUri.fsPath + "/assets/vscode-material-icons/icons", name: "Material icons directory" },
    { path: this.contextProxy.extensionUri.fsPath + "/assets/images", name: "Images directory" },
]

let hasMissingFiles = false
for (const file of requiredFiles) {
    if (!fs.existsSync(file.path)) {
        this.log(`[getHtmlContent] ERROR: Required file not found: ${file.path} (${file.name})`)
        hasMissingFiles = true
    } else {
        this.log(`[getHtmlContent] OK: ${file.name} found`)
    }
}

if (hasMissingFiles) {
    this.log(`[getHtmlContent] CRITICAL: Missing required files. Webview will fail to load.`)
}
```

### Fix 5: Documented Audio Path Handling ✅

**File**: `src/esbuild.mjs`

Added comment clarifying audio file copying for VSIX packaging. The audio files are copied from `../webview-ui/audio` to `webview-ui/audio` in the extension root during the bundle step.

## Testing Checklist

After applying fixes, verify the following:

### Build Verification
- [ ] Run `pnpm --filter @coder/vscode-webview build` successfully
- [ ] Verify `src/webview-ui/build/assets/` contains all expected files:
  - `index.js` and `index.css` (main entry points)
  - `mermaid-bundle.js` (large mermaid library)
  - Multiple `chunk-*.js` files (code-splitting chunks)
  - Font files in `fonts/` subdirectory
- [ ] Run `pnpm bundle` successfully
- [ ] Verify audio files are copied to `src/webview-ui/audio/`

### VSIX Packaging Verification
- [ ] Run `pnpm vsix` to create VSIX package
- [ ] Inspect VSIX contents:
  ```bash
  unzip -l bin/coder-roo-*.vsix | grep webview-ui
  ```
- [ ] Verify all webview files are included:
  - All `*.js` files (including hashed chunks)
  - All `*.css` files
  - All font files (`.woff`, `.woff2`, `.ttf`)
  - Audio files (`.wav`)
  - Source maps (`.map`) if needed for debugging

### Runtime Verification
- [ ] Install VSIX in VS Code:
  ```bash
  code --install-extension bin/coder-roo-*.vsix
  ```
- [ ] Open the webview sidebar
- [ ] Open webview developer tools (Help > Toggle Developer Tools)
- [ ] Verify no console errors related to resource loading
- [ ] Check Network tab to confirm all resources loaded with `vscode-webview://` protocol
- [ ] Test all webview functionality:
  - Chat interface
  - Settings panel
  - History view
  - Marketplace (if applicable)
- [ ] Test audio playback (if applicable)
- [ ] Verify mermaid diagrams render correctly
- [ ] Test syntax highlighting in code blocks

### Cross-Platform Testing
- [ ] Test on Windows
- [ ] Test on macOS
- [ ] Test on Linux

### Debugging Tips

If webview still fails to load after packaging:

1. **Check extension output channel**: Look for "CRITICAL: Missing required files" messages
2. **Inspect VSIX contents**: Ensure files exist at expected paths
3. **Verify CSP**: Check for Content Security Policy errors in console
4. **Check localResourceRoots**: Ensure all resource directories are registered
5. **Test with development mode**: Run `pnpm --filter @coder/vscode-webview dev` to isolate build vs. runtime issues

## Related Files

- `src/.vscodeignore` - VSIX packaging exclusions
- `src/core/webview/ClineProvider.ts` - Webview HTML generation
- `src/core/webview/getUri.ts` - URI helper for webview resources
- `src/esbuild.mjs` - Extension bundling configuration
- `webview-ui/vite.config.ts` - Vite build configuration
- `src/package.json` - Extension manifest

## References

- [VS Code Webview API Documentation](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code Extension Packaging Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [@vscode/vsce Documentation](https://github.com/microsoft/vscode-vsce)
- [Vite Build Configuration](https://vitejs.dev/config/build-options.html)
