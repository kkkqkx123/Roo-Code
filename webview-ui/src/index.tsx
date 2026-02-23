import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App"
import "../node_modules/@vscode/codicons/dist/codicon.css"

import { getHighlighter } from "./utils/highlighter"

// Log webview initialization for debugging
console.log('[WebView] index.tsx: Starting webview initialization')
console.log('[WebView] Document base URI:', document.baseURI)
console.log('[WebView] Available scripts:', document.scripts.length)

// Initialize Shiki early to hide initialization latency (async)
getHighlighter().catch((error: Error) => console.error("Failed to initialize Shiki highlighter:", error))

const rootElement = document.getElementById("root")
if (!rootElement) {
	console.error('[WebView] Root element not found!')
} else {
	console.log('[WebView] Root element found, rendering App...')
	createRoot(rootElement).render(
		<StrictMode>
			<App />
		</StrictMode>,
	)
}
