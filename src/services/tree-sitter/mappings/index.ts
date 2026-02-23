import type { StandardDefinitionType } from "../types"
import { mapType as mapTypeScript } from "./typescript"
import { mapType as mapJavaScript } from "./javascript"
import { mapType as mapC } from "./c"
import { mapType as mapCpp } from "./cpp"
import { mapType as mapRust } from "./rust"
import { mapType as mapGo } from "./go"
import { mapType as mapPython } from "./python"
import { mapType as mapJava } from "./java"
import { mapType as mapPhp } from "./php"
import { mapType as mapRuby } from "./ruby"
import { mapType as mapSwift } from "./swift"
import { mapType as mapKotlin } from "./kotlin"
import { mapType as mapScala } from "./scala"
import { mapType as mapCSharp } from "./c-sharp"
import { mapType as mapElixir } from "./elixir"
import { mapType as mapOcaml } from "./ocaml"

/**
 * 语言映射器类型
 */
type LanguageMapper = (originalType: string) => StandardDefinitionType

/**
 * 语言到映射器的映射表
 */
export const LANGUAGE_MAPPERS: Record<string, LanguageMapper> = {
	typescript: mapTypeScript,
	javascript: mapJavaScript,
	js: mapJavaScript,
	jsx: mapJavaScript,
	ts: mapTypeScript,
	tsx: mapTypeScript,
	c: mapC,
	h: mapC,
	cpp: mapCpp,
	hpp: mapCpp,
	rust: mapRust,
	rs: mapRust,
	go: mapGo,
	python: mapPython,
	py: mapPython,
	java: mapJava,
	php: mapPhp,
	ruby: mapRuby,
	rb: mapRuby,
	swift: mapSwift,
	kotlin: mapKotlin,
	kt: mapKotlin,
	kts: mapKotlin,
	scala: mapScala,
	"c-sharp": mapCSharp,
	cs: mapCSharp,
	elixir: mapElixir,
	ex: mapElixir,
	exs: mapElixir,
	ocaml: mapOcaml,
	ml: mapOcaml,
	mli: mapOcaml,
}

/**
 * 别名映射（用于文件扩展名到语言名称的转换）
 */
const LANGUAGE_ALIASES: Record<string, string> = {
	js: "javascript",
	jsx: "javascript",
	ts: "typescript",
	tsx: "typescript",
	h: "c",
	hpp: "cpp",
	rs: "rust",
	py: "python",
	rb: "ruby",
	kt: "kotlin",
	kts: "kotlin",
	cs: "c-sharp",
	ex: "elixir",
	exs: "elixir",
	ml: "ocaml",
	mli: "ocaml",
}

/**
 * 将语言特定类型映射到标准类型
 *
 * @param language - 语言名称或文件扩展名
 * @param originalType - 原始类型名称
 * @returns 标准化类型
 */
export function mapToStandardType(language: string, originalType: string): StandardDefinitionType {
	// 标准化语言名称
	const normalizedLanguage = LANGUAGE_ALIASES[language] || language

	// 获取对应的映射器
	const mapper = LANGUAGE_MAPPERS[normalizedLanguage]

	if (!mapper) {
		return "other"
	}

	return mapper(originalType)
}

/**
 * 获取语言的标准名称
 *
 * @param language - 语言名称或文件扩展名
 * @returns 标准化的语言名称
 */
export function getStandardLanguageName(language: string): string {
	return LANGUAGE_ALIASES[language] || language
}