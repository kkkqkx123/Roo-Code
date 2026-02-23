/**
 * CommonJS entry point for VSCode extension.
 *
 * VSCode loads extensions using require(), which expects CommonJS format.
 * This wrapper dynamically imports the actual ESM extension code.
 *
 * @see https://jan.miksovsky.com/posts/2025/03-17-vs-code-extension
 */

const path = require("path");
const url = require("url");

// IMPORTANT: Set globalThis values BEFORE importing extension.mjs
// This is needed because esbuild inlines the extension.mjs code,
// and the initialization runs before the activatePromise executes.
globalThis.vscode = require("vscode");
globalThis.__filename = __filename;
globalThis.__dirname = __dirname;

// Use dynamic import to load the ESM extension code
// This is an async operation since ES modules are asynchronous
const activatePromise = (async () => {
	// Dynamically import the ESM extension module
	const extension = await import("./extension.mjs");

	// Export the activate and deactivate handlers
	return {
		activate: (...args) => extension.activate(...args),
		deactivate: () => extension.deactivate?.(),
	};
})();

// Synchronously export the activation handlers
// The actual activation happens asynchronously inside the IIFE
module.exports = {
	activate: async (...args) => {
		const { activate } = await activatePromise;
		return activate(...args);
	},
	deactivate: async () => {
		const { deactivate } = await activatePromise;
		return deactivate();
	},
};
