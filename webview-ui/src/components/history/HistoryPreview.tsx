import { memo, useState } from "react"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"

import { useTaskSearch } from "./useTaskSearch"
import { useGroupedTasks } from "./useGroupedTasks"
import TaskGroupItem from "./TaskGroupItem"
import { DeleteTaskDialog } from "./DeleteTaskDialog"
import { countAllSubtasks } from "./types"

const HistoryPreview = () => {
	const { tasks, searchQuery } = useTaskSearch()
	const { groups, toggleExpand } = useGroupedTasks(tasks, searchQuery)
	const { t } = useAppTranslation()

	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const [deleteSubtaskCount, setDeleteSubtaskCount] = useState<number>(0)

	const handleViewAllHistory = () => {
		vscode.postMessage({ type: "switchTab", tab: "history" })
	}

	const handleDelete = (taskId: string) => {
		const group = groups.find((g) => g.parent.id === taskId)
		const subtaskCount = group ? countAllSubtasks(group.subtasks) : 0
		setDeleteTaskId(taskId)
		setDeleteSubtaskCount(subtaskCount)
	}

	// Show up to 8 groups (parent + subtasks count as 1 block)
	const displayGroups = groups.slice(0, 8)

	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-wrap items-center justify-between mt-4 mb-2">
				<h2 className="font-semibold text-lg grow m-0">{t("history:recentTasks")}</h2>
				<button
					onClick={handleViewAllHistory}
					className="text-base text-vscode-descriptionForeground hover:text-vscode-textLink-foreground transition-colors cursor-pointer"
					aria-label={t("history:viewAllHistory")}>
					{t("history:viewAllHistory")}
				</button>
			</div>
			{displayGroups.length !== 0 && (
				<>
					{displayGroups.map((group) => (
						<TaskGroupItem
							key={group.parent.id}
							group={group}
							variant="compact"
							onDelete={handleDelete}
							onToggleExpand={() => toggleExpand(group.parent.id)}
							onToggleSubtaskExpand={toggleExpand}
						/>
					))}
				</>
			)}

			{/* Delete dialog */}
			{deleteTaskId && (
				<DeleteTaskDialog
					taskId={deleteTaskId}
					subtaskCount={deleteSubtaskCount}
					onOpenChange={(open) => {
						if (!open) {
							setDeleteTaskId(null)
							setDeleteSubtaskCount(0)
						}
					}}
					open
				/>
			)}
		</div>
	)
}

export default memo(HistoryPreview)
