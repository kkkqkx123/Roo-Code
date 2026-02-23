import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { ProviderSettings } from "@coder/types"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"

import ApiOptions from "../ApiOptions"
import { MODELS_BY_PROVIDER, PROVIDERS } from "../constants"

// Mock the extension state context
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(() => ({
		cloudIsAuthenticated: false,
	})),
}))

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock vscode
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock the selected model hook
vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: vi.fn(() => ({
		provider: "anthropic",
		id: "claude-3-5-sonnet-20241022",
		info: null,
	})),
}))


// Mock the SearchableSelect component to capture the options passed to it
vi.mock("@src/components/ui", () => ({
	SearchableSelect: ({ options, ...props }: any) => {
		// Store the options in a data attribute for testing
		return (
			<div data-testid="searchable-select" data-options={JSON.stringify(options)} {...props}>
				{options.map((opt: any) => (
					<div key={opt.value} data-testid={`option-${opt.value}`}>
						{opt.label}
					</div>
				))}
			</div>
		)
	},
	Select: ({ children }: any) => <div>{children}</div>,
	SelectTrigger: ({ children }: any) => <div>{children}</div>,
	SelectValue: ({ placeholder }: any) => <div>{placeholder}</div>,
	SelectContent: ({ children }: any) => <div>{children}</div>,
	SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
	Collapsible: ({ children }: any) => <div>{children}</div>,
	CollapsibleTrigger: ({ children }: any) => <div>{children}</div>,
	CollapsibleContent: ({ children }: any) => <div>{children}</div>,
	Slider: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
	// Add Popover components for ModelPicker
	Popover: ({ children }: any) => <div>{children}</div>,
	PopoverTrigger: ({ children }: any) => <div>{children}</div>,
	PopoverContent: ({ children }: any) => <div>{children}</div>,
	// Add Command components for ModelPicker
	Command: ({ children }: any) => <div>{children}</div>,
	CommandInput: ({ ...props }: any) => <input {...props} />,
	CommandList: ({ children }: any) => <div>{children}</div>,
	CommandEmpty: ({ children }: any) => <div>{children}</div>,
	CommandGroup: ({ children }: any) => <div>{children}</div>,
	CommandItem: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}))

describe("ApiOptions Provider Filtering", () => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	})

	const defaultProps = {
		uriScheme: "vscode",
		apiConfiguration: {
			apiProvider: "anthropic",
			apiKey: "test-key",
		} as ProviderSettings,
		setApiConfigurationField: vi.fn(),
		fromWelcomeView: false,
		errorMessage: undefined,
		setErrorMessage: vi.fn(),
	}

	const renderWithProviders = (props = defaultProps) => {
		return render(
			<QueryClientProvider client={queryClient}>
				<ApiOptions {...props} />
			</QueryClientProvider>,
		)
	}

	it("should show all providers", () => {
		renderWithProviders()

		const selectElement = screen.getByTestId("provider-select")
		const options = JSON.parse(selectElement.getAttribute("data-options") || "[]")

		// Should include all available providers
		const providerValues = options.map((opt: any) => opt.value)
		expect(providerValues).toContain("anthropic") // static provider
		expect(providerValues).toContain("gemini") // static provider
		expect(providerValues).toContain("openai-native") // static provider
		expect(providerValues).toContain("openai") // dynamic provider
	})
})
