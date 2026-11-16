import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Signing is only reachable through WalletProvider.signTransaction, which
    // shows the wallet approval sheet. Modules must not import the session directly.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/wallet/**", "src/lib/wallet/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["@/lib/wallet/session", "**/lib/wallet/session"], message: "Use useStellarWallet().signTransaction — signing requires the wallet approval sheet." }]
      }]
    }
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts"
  ])
]);

export default eslintConfig;
