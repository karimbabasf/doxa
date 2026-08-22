import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Vendored component kits. Both are copy-paste libraries: their files were
    // written against their own lint setup, and against this one they report 164
    // errors, almost all of them the React Compiler rules about touching refs
    // during render. They are not our code to fix and editing them would be
    // undone by the next `dither-kit update`, so they are excluded here rather
    // than silenced line by line inside ninety three files.
    //
    // The cost is real and worth naming: a genuine bug introduced into one of
    // these files by us would not be caught by lint. Anything we write that uses
    // them still is.
    "components/interior/**",
    "components/dither-kit/**",
  ]),
]);

export default eslintConfig;
