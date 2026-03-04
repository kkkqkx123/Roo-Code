import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"

import { vscode } from "@/utils/vscode"
import { Button } from "../ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog"
import { CopyIcon, DownloadIcon, Loader2Icon } from "lucide-react"
import { useCopyToClipboard } from "@/utils/clipboard"

interface SystemPromptPreviewDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export const SystemPromptPreviewDialog = ({ open, onOpenChange }: SystemPromptPreviewDialogProps) => {
	const { t } = useTranslation()
	const { copyWithFeedback } = useCopyToClipboard()
	const [systemPrompt, setSystemPrompt] = useState<string>("")
	const [isLoading, setIsLoading] = useState(false)

	useEffect(() => {
		if (open) {
			setIsLoading(true)
			setSystemPrompt("")
			vscode.postMessage({ type: "getSystemPrompt" })

			const handleMessage = (event: MessageEvent) => {
				if (event.data.type === "systemPrompt") {
					setSystemPrompt(event.data.text || "")
					setIsLoading(false)
				}
			}

			window.addEventListener("message", handleMessage)
			return () => window.removeEventListener("message", handleMessage)
		}
	}, [open])

	const handleCopy = async () => {
		if (systemPrompt) {
			await copyWithFeedback(systemPrompt)
		}
	}

	const handleExport = () => {
		if (systemPrompt) {
			const blob = new Blob([systemPrompt], { type: "text/plain" })
			const url = URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = `system-prompt-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`
			document.body.appendChild(a)
			a.click()
			document.body.removeChild(a)
			URL.revokeObjectURL(url)
		}
	}

	const handleClose = () => {
		onOpenChange(false)
		setSystemPrompt("")
	}

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>{t("chat:task.systemPromptPreview")}</DialogTitle>
				</DialogHeader>

				<div className="flex-1 overflow-hidden mt-4">
					{isLoading ? (
						<div className="flex items-center justify-center h-full py-8">
							<Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
							<span className="ml-2 text-sm text-muted-foreground">{t("common:loading")}</span>
						</div>
					) : (
						<div className="h-full overflow-auto">
							<pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-4 rounded-md">
								{systemPrompt || t("chat:task.noSystemPrompt")}
							</pre>
						</div>
					)}
				</div>

				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={handleCopy} disabled={!systemPrompt || isLoading}>
						<CopyIcon className="h-4 w-4 mr-2" />
						{t("common:actions.copy")}
					</Button>
					<Button variant="outline" onClick={handleExport} disabled={!systemPrompt || isLoading}>
						<DownloadIcon className="h-4 w-4 mr-2" />
						{t("common:actions.export")}
					</Button>
					<Button onClick={handleClose}>{t("common:actions.close")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
