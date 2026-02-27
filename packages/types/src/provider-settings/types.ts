import { z } from "zod"

/**
 * CustomProvider
 *
 * Custom providers are completely configurable within Coder settings.
 */

export const customProviders = ["openai"] as const

export type CustomProvider = (typeof customProviders)[number]

export const isCustomProvider = (key: string): key is CustomProvider =>
	customProviders.includes(key as CustomProvider)

/**
 * ProviderName
 */

export const providerNames = [
	...customProviders,
	"anthropic",
	"gemini",
	"openai-native",
] as const

export const providerNamesSchema = z.enum(providerNames)

export type ProviderName = (typeof providerNames)[number]

export const isProviderName = (key: unknown): key is ProviderName =>
	typeof key === "string" && providerNames.includes(key as ProviderName)

/**
 * TypicalProvider
 */

export type TypicalProvider = Exclude<ProviderName, CustomProvider>

export const isTypicalProvider = (key: unknown): key is TypicalProvider =>
	isProviderName(key) && !isCustomProvider(key)
