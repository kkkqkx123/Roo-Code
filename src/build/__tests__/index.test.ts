// npx vitest run src/build/__tests__/index.test.ts

import { generatePackageJson } from "../index.js"

describe("generatePackageJson", () => {
	it("should be a test", () => {
		const generatedPackageJson = generatePackageJson({
			packageJson: {
				name: "coder-roo",
				displayName: "%extension.displayName%",
				description: "%extension.description%",
				publisher: "Kkkqkx",
				version: "3.17.2",
				icon: "assets/icons/icon.png",
				contributes: {
					viewsContainers: {
						activitybar: [
							{
								id: "coder-roo-ActivityBar",
								title: "%views.activitybar.title%",
								icon: "assets/icons/icon.svg",
							},
						],
					},
					views: {
						"coder-roo-ActivityBar": [
							{
								type: "webview",
								id: "coder-roo.SidebarProvider",
								name: "",
							},
						],
					},
					commands: [
						{
							command: "coder-roo.plusButtonClicked",
							title: "%command.newTask.title%",
							icon: "$(edit)",
						},
						{
							command: "coder-roo.openInNewTab",
							title: "%command.openInNewTab.title%",
							category: "%configuration.title%",
						},
					],
					menus: {
						"editor/context": [
							{
								submenu: "coder-roo.contextMenu",
								group: "navigation",
							},
						],
						"coder-roo.contextMenu": [
							{
								command: "coder-roo.addToContext",
								group: "1_actions@1",
							},
						],
						"editor/title": [
							{
								command: "coder-roo.plusButtonClicked",
								group: "navigation@1",
								when: "activeWebviewPanelId == coder-roo.TabPanelProvider",
							},
							{
								command: "coder-roo.settingsButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == coder-roo.TabPanelProvider",
							},
							{
								command: "coder-roo.accountButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == coder-roo.TabPanelProvider",
							},
						],
					},
					submenus: [
						{
							id: "coder-roo.contextMenu",
							label: "%views.contextMenu.label%",
						},
						{
							id: "coder-roo.terminalMenu",
							label: "%views.terminalMenu.label%",
						},
					],
					configuration: {
						title: "%configuration.title%",
						properties: {
							"coder-roo.allowedCommands": {
								type: "array",
								items: {
									type: "string",
								},
								default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
								description: "%commands.allowedCommands.description%",
							},
							"coder-roo.customStoragePath": {
								type: "string",
								default: "",
								description: "%settings.customStoragePath.description%",
							},
						},
					},
				},
				scripts: {
					lint: "eslint **/*.ts",
				},
			},
			overrideJson: {
				name: "coder-nightly",
				displayName: "Coder Nightly",
				publisher: "Kkkqkx",
				version: "0.0.1",
				icon: "assets/icons/icon-nightly.png",
				scripts: {},
			},
			substitution: ["coder-roo", "coder-nightly"],
		})

		expect(generatedPackageJson).toStrictEqual({
			name: "coder-nightly",
			displayName: "Coder Nightly",
			description: "%extension.description%",
			publisher: "Kkkqkx",
			version: "0.0.1",
			icon: "assets/icons/icon-nightly.png",
			contributes: {
				viewsContainers: {
					activitybar: [
						{
							id: "coder-nightly-ActivityBar",
							title: "%views.activitybar.title%",
							icon: "assets/icons/icon.svg",
						},
					],
				},
				views: {
					"coder-nightly-ActivityBar": [
						{
							type: "webview",
							id: "coder-nightly.SidebarProvider",
							name: "",
						},
					],
				},
				commands: [
					{
						command: "coder-nightly.plusButtonClicked",
						title: "%command.newTask.title%",
						icon: "$(edit)",
					},
					{
						command: "coder-nightly.openInNewTab",
						title: "%command.openInNewTab.title%",
						category: "%configuration.title%",
					},
				],
				menus: {
					"editor/context": [
						{
							submenu: "coder-nightly.contextMenu",
							group: "navigation",
						},
					],
					"coder-nightly.contextMenu": [
						{
							command: "coder-nightly.addToContext",
							group: "1_actions@1",
						},
					],
					"editor/title": [
						{
							command: "coder-nightly.plusButtonClicked",
							group: "navigation@1",
							when: "activeWebviewPanelId == coder-nightly.TabPanelProvider",
						},
						{
							command: "coder-nightly.settingsButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == coder-nightly.TabPanelProvider",
						},
						{
							command: "coder-nightly.accountButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == coder-nightly.TabPanelProvider",
						},
					],
				},
				submenus: [
					{
						id: "coder-nightly.contextMenu",
						label: "%views.contextMenu.label%",
					},
					{
						id: "coder-nightly.terminalMenu",
						label: "%views.terminalMenu.label%",
					},
				],
				configuration: {
					title: "%configuration.title%",
					properties: {
						"coder-nightly.allowedCommands": {
							type: "array",
							items: {
								type: "string",
							},
							default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
							description: "%commands.allowedCommands.description%",
						},
						"coder-nightly.customStoragePath": {
							type: "string",
							default: "",
							description: "%settings.customStoragePath.description%",
						},
					},
				},
			},
			scripts: {},
		})
	})
})
