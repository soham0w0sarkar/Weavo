import type { Monaco } from "@monaco-editor/react";

export const DEMO_LANGUAGES = [
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "css", label: "CSS" },
  { id: "html", label: "HTML" },
  { id: "markdown", label: "Markdown" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "plaintext", label: "Plain text" },
] as const;

export type DemoLanguage = (typeof DEMO_LANGUAGES)[number]["id"];

export const DEFAULT_DEMO_LANGUAGE: DemoLanguage = "typescript";

/** Languages with Monaco's built-in workers (IntelliSense + diagnostics). */
export const hasLanguageService = (language: string) =>
  language === "typescript" ||
  language === "javascript" ||
  language === "json" ||
  language === "css" ||
  language === "html";

/**
 * Turn on Monaco's in-browser TS/JS language service.
 * This is not a full project LSP (no node_modules), but it gives completions,
 * hover, signature help, and syntax/semantic squiggles in the demo.
 */
export const configureLanguageServices = (monaco: Monaco) => {
  const ts = monaco.languages.typescript;

  const compilerOptions: Parameters<
    typeof ts.typescriptDefaults.setCompilerOptions
  >[0] = {
    target: ts.ScriptTarget.ES2022,
    allowNonTsExtensions: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    esModuleInterop: true,
    allowJs: true,
    checkJs: true,
    strict: true,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["es2022", "dom", "dom.iterable"],
  };

  const diagnostics = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  };

  ts.typescriptDefaults.setCompilerOptions(compilerOptions);
  ts.typescriptDefaults.setDiagnosticsOptions(diagnostics);
  ts.typescriptDefaults.setEagerModelSync(true);

  ts.javascriptDefaults.setCompilerOptions(compilerOptions);
  ts.javascriptDefaults.setDiagnosticsOptions(diagnostics);
  ts.javascriptDefaults.setEagerModelSync(true);

  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    schemas: [],
    enableSchemaRequest: false,
  });

  monaco.languages.css.cssDefaults.setOptions({
    validate: true,
  });

  monaco.languages.html.htmlDefaults.setOptions({
    format: {
      tabSize: 2,
      insertSpaces: true,
      wrapLineLength: 120,
      unformatted: "wbr",
      contentUnformatted: "pre,code,textarea",
      indentInnerHtml: false,
      preserveNewLines: true,
      maxPreserveNewLines: undefined,
      indentHandlebars: false,
      endWithNewline: false,
      extraLiners: "head, body, /html",
      wrapAttributes: "auto",
    },
  });
};
