import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Phase 11, Deliverable 3: this repo was hand-built (never scaffolded via `create-next-app`), so
 * it never got a lint setup at all — confirmed by `find . -name ".eslintrc*" -o -name
 * "eslint.config*"` returning nothing before this phase. Just `eslint-config-next`'s own default
 * ruleset (`core-web-vitals` + its TypeScript rules) — no custom rules added beyond it, per the
 * kickoff's own explicit instruction not to impose a new style regime this late.
 *
 * Imported as direct flat-config subpaths (`eslint-config-next/core-web-vitals` /
 * `.../typescript`), NOT via `@eslint/eslintrc`'s `FlatCompat.extends("next/core-web-vitals")` —
 * this version of `eslint-config-next` already ships native flat config (each subpath's own
 * `dist/*.js` is itself a flat config array), and running an already-flat config back through
 * `FlatCompat` (built for translating legacy `.eslintrc`-shaped configs) produced a real
 * `TypeError: Converting circular structure to JSON` crash — a genuine, confirmed incompatibility
 * between that translation shim and this package's actual (already-flat) export shape, not a
 * config mistake on the rule content itself. Importing the flat arrays directly resolved it.
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "data/**",
      "logs/**",
      "output/**",
      "drizzle/**",
      "public/sw.js",
    ],
  },
  {
    // The one deliberate rule tweak, not a new rule set: this codebase already used a leading
    // underscore for an intentionally-unused parameter (e.g. a mock function matching a shared
    // callback signature where only some arguments are relevant) in many places across all ten
    // prior phases, before lint ever existed to check it — `argsIgnorePattern`/`varsIgnorePattern`
    // just recognizes that pre-existing, real convention instead of flagging every instance of it.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];

export default eslintConfig;
