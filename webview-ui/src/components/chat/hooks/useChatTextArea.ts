import { useEffect, useState, useRef } from "react"

import type { SearchResult } from "@src/utils/context-mentions"
import { ContextMenuOptionType } from "@src/utils/context-mentions"

interface UseChatTextAreaOptions {
	inputValue: string
	setInputValue: (value: string) => void
	setIsEnhancingPrompt: (isEnhancing: boolean) => void
	setShowContextMenu?: (show: boolean) => void
}

interface UseChatTextAreaReturn {
	// State
	gitCommits: any[]
	fileSearchResults: SearchResult[]
	searchLoading: boolean

	// State setters
	setSearchLoading: (loading: boolean) => void
	setFileSearchResults: (results: SearchResult[]) => void
	setSearchRequestId: (requestId: string) => void
}

export function useChatTextArea({
	inputValue,
	setInputValue,
	setIsEnhancingPrompt,
}: UseChatTextAreaOptions): UseChatTextAreaReturn {
	const [gitCommits, setGitCommits] = useState<any[]>([])
	const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>([])
	const [searchLoading, setSearchLoading] = useState(false)
	const searchRequestIdRef = useRef("")
	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

	// Handle enhanced prompt response and search results
	useEffect(() => {
		const messageHandler = (event: MessageEvent) => {
			const message = event.data

			if (message.type === "enhancedPrompt") {
				if (message.text && textAreaRef.current) {
					try {
						// Use execCommand to replace text while preserving undo history
						if (document.execCommand) {
							const textarea = textAreaRef.current
							textarea.focus()
							textarea.select()
							document.execCommand("insertText", false, message.text)
						} else {
							setInputValue(message.text)
						}
					} catch {
						setInputValue(message.text)
					}
				}

				setIsEnhancingPrompt(false)
			} else if (message.type === "insertTextIntoTextarea") {
				if (message.text && textAreaRef.current) {
					const currentValue = inputValue
					const cursorPos = textAreaRef.current.selectionStart || 0

					// Check if we need to add a space before the command
					const textBefore = currentValue.slice(0, cursorPos)
					const needsSpaceBefore = textBefore.length > 0 && !textBefore.endsWith(" ")
					const prefix = needsSpaceBefore ? " " : ""

					// Insert the text at cursor position
					const newValue =
						currentValue.slice(0, cursorPos) +
						prefix +
						message.text +
						" " +
						currentValue.slice(cursorPos)
					setInputValue(newValue)

					// Set cursor position after the inserted text
					const newCursorPos = cursorPos + prefix.length + message.text.length + 1
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.focus()
							textAreaRef.current.setSelectionRange(newCursorPos, newCursorPos)
						}
					}, 0)
				}
			} else if (message.type === "commitSearchResults") {
				const commits = message.commits.map((commit: any) => ({
					type: ContextMenuOptionType.Git,
					value: commit.hash,
					label: commit.subject,
					description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
					icon: "$(git-commit)",
				}))

				setGitCommits(commits)
			} else if (message.type === "fileSearchResults") {
				setSearchLoading(false)
				if (message.requestId === searchRequestIdRef.current) {
					setFileSearchResults(message.results || [])
				}
			}
		}

		window.addEventListener("message", messageHandler)
		return () => window.removeEventListener("message", messageHandler)
	}, [setInputValue, inputValue, setIsEnhancingPrompt])

	return {
		gitCommits,
		fileSearchResults,
		searchLoading,
		setSearchLoading,
		setFileSearchResults,
		setSearchRequestId: (requestId: string) => {
			searchRequestIdRef.current = requestId
		},
	}
}
