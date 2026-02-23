// npx vitest src/components/welcome/__tests__/WelcomeViewProvider.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"

import * as ExtensionStateContext from "@src/context/ExtensionStateContext"
const { ExtensionStateContextProvider } = ExtensionStateContext

import WelcomeViewProvider from "../WelcomeViewProvider"
import { vscode } from "@src/utils/vscode"

// Mock VSCode components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, onClick }: any) => (
		<button onClick={onClick} data-testid="vscode-link">
			{children}
		</button>
	),
	VSCodeProgressRing: () => <div data-testid="progress-ring">Loading...</div>,
	VSCodeTextField: ({ value, onKeyUp, placeholder }: any) => (
		<input data-testid="text-field" type="text" value={value} onChange={onKeyUp} placeholder={placeholder} />
	),
	VSCodeRadioGroup: ({ children, value, _onChange }: any) => (
		<div data-testid="radio-group" data-value={value}>
			{children}
		</div>
	),
	VSCodeRadio: ({ children, value, onClick }: any) => (
		<div data-testid={`radio-${value}`} data-value={value} onClick={onClick}>
			{children}
		</div>
	),
}))

// Mock Button component
vi.mock("@src/components/ui", () => ({
	Button: ({ children, onClick, variant }: any) => (
		<button onClick={onClick} data-testid={`button-${variant}`}>
			{children}
		</button>
	),
}))

// Mock ApiOptions
vi.mock("../../settings/ApiOptions", () => ({
	default: () => <div data-testid="api-options">API Options Component</div>,
}))

// Mock Tab components
vi.mock("../../common/Tab", () => ({
	Tab: ({ children }: any) => <div data-testid="tab">{children}</div>,
	TabContent: ({ children }: any) => <div data-testid="tab-content">{children}</div>,
}))

// Mock RooHero
vi.mock("../RooHero", () => ({
	default: () => <div data-testid="roo-hero">Roo Hero</div>,
}))

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
	ArrowLeft: () => <span data-testid="arrow-left-icon">←</span>,
	ArrowRight: () => <span data-testid="arrow-right-icon">→</span>,
	BadgeInfo: () => <span data-testid="badge-info-icon">ℹ</span>,
	Brain: () => <span data-testid="brain-icon">🧠</span>,
	TriangleAlert: () => <span data-testid="triangle-alert-icon">⚠</span>,
}))

// Mock vscode utility
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock react-i18next
vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: any) => <span data-testid={`trans-${i18nKey}`}>{children || i18nKey}</span>,
	initReactI18next: {
		type: "3rdParty",
		init: () => { },
	},
}))

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock buildDocLink
vi.mock("@/utils/docLinks", () => ({
	buildDocLink: (path: string, source: string) => `https://docs.coder.com/${path}?utm_source=${source}`,
}))

const renderWelcomeViewProvider = (extensionState = {}) => {
	const useExtensionStateMock = vi.spyOn(ExtensionStateContext, "useExtensionState")
	useExtensionStateMock.mockReturnValue({
		apiConfiguration: {},
		currentApiConfigName: "default",
		setApiConfiguration: vi.fn(),
		uri_scheme: "vscode",
		cloudIsAuthenticated: false,
		...extensionState,
	} as any)

	render(
		<ExtensionStateContextProvider>
			<WelcomeViewProvider />
		</ExtensionStateContextProvider>,
	)

	return useExtensionStateMock
}

describe("WelcomeViewProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Landing Screen", () => {
		it("renders landing screen by default", () => {
			renderWelcomeViewProvider()

			// Should show the landing greeting
			expect(screen.getByText(/welcome:landing.greeting/)).toBeInTheDocument()

			// Should show introduction
			expect(screen.getByTestId("trans-welcome:landing.introduction")).toBeInTheDocument()

			// Should show account mention
			expect(screen.getByTestId("trans-welcome:landing.accountMention")).toBeInTheDocument()

			// Should show "Get Started" button
			expect(screen.getByTestId("button-primary")).toBeInTheDocument()

			// Should show "import settings" button
			expect(screen.getByText(/welcome:importSettings/)).toBeInTheDocument()
		})

		it("navigates to provider configuration when 'Get Started' is clicked", () => {
			renderWelcomeViewProvider()

			const getStartedButton = screen.getByTestId("button-primary")
			fireEvent.click(getStartedButton)

			// Should now show provider configuration screen
			expect(screen.getByTestId("brain-icon")).toBeInTheDocument()
			expect(screen.getByText(/welcome:providerSignup.heading/)).toBeInTheDocument()
			expect(screen.getByTestId("api-options")).toBeInTheDocument()
		})

		it("triggers import settings when import button is clicked", () => {
			renderWelcomeViewProvider()

			const importButton = screen.getByText(/welcome:importSettings/)
			fireEvent.click(importButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "importSettings",
			})
		})
	})

	describe("Provider Configuration Screen", () => {
		const navigateToProviderConfig = () => {
			const getStartedButton = screen.getByTestId("button-primary")
			fireEvent.click(getStartedButton)
		}

		it("shows provider configuration screen after clicking Get Started", () => {
			renderWelcomeViewProvider()
			navigateToProviderConfig()

			// Should show brain icon
			expect(screen.getByTestId("brain-icon")).toBeInTheDocument()

			// Should show heading
			expect(screen.getByText(/welcome:providerSignup.heading/)).toBeInTheDocument()

			// Should show choose provider text
			expect(screen.getByTestId("trans-welcome:providerSignup.chooseProvider")).toBeInTheDocument()

			// Should show API options
			expect(screen.getByTestId("api-options")).toBeInTheDocument()

			// Should show back button
			expect(screen.getByTestId("button-secondary")).toBeInTheDocument()

			// Should show finish button
			expect(screen.getByTestId("button-primary")).toBeInTheDocument()
		})

		it("returns to landing screen when Go Back is clicked", () => {
			renderWelcomeViewProvider()
			navigateToProviderConfig()

			// Verify we're on provider configuration screen
			expect(screen.getByTestId("brain-icon")).toBeInTheDocument()

			// Click Go Back
			const goBackButton = screen.getByTestId("button-secondary")
			fireEvent.click(goBackButton)

			// Should be back on landing screen
			expect(screen.getByText(/welcome:landing.greeting/)).toBeInTheDocument()
			expect(screen.getByTestId("trans-welcome:landing.introduction")).toBeInTheDocument()
			expect(screen.queryByTestId("brain-icon")).not.toBeInTheDocument()
		})

		it("saves configuration when Finish is clicked", () => {
			const mockSetApiConfiguration = vi.fn()
			renderWelcomeViewProvider({
				setApiConfiguration: mockSetApiConfiguration,
			})
			navigateToProviderConfig()

			const finishButton = screen.getByTestId("button-primary")
			fireEvent.click(finishButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "upsertApiConfiguration",
				text: "default",
				apiConfiguration: {},
			})
		})

		it("saves configuration with custom apiConfiguration when Finish is clicked", () => {
			const customConfig = {
				apiProvider: "openrouter",
				apiKey: "test-key",
			}
			const mockSetApiConfiguration = vi.fn()
			renderWelcomeViewProvider({
				apiConfiguration: customConfig,
				setApiConfiguration: mockSetApiConfiguration,
			})
			navigateToProviderConfig()

			const finishButton = screen.getByTestId("button-primary")
			fireEvent.click(finishButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "upsertApiConfiguration",
				text: "default",
				apiConfiguration: customConfig,
			})
		})
	})
})