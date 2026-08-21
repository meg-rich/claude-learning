import react from "@vitejs/plugin-react";
import babel from "vite-plugin-babel";
import { defineConfig } from "vite";

const API_PORT = process.env.API_PORT ?? "3001";

// The API key lives only in the Express process, so the browser talks to it
// through this proxy rather than to api.anthropic.com directly.
export default defineConfig({
  plugins: [
    // Inject a stable id into every FormattedMessage / defineMessages call by
    // hashing its defaultMessage. Must match the pattern in package.json's
    // i18n:extract script so the runtime ids line up with the compiled catalog.
    // Scoped to src/ only; we let the babel parser handle TS+JSX via syntax-only
    // plugins (no transform) so oxc still owns the actual TypeScript lowering.
    babel({
      include: /\.tsx?$/,
      exclude: /node_modules/,
      babelConfig: {
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ["typescript", "jsx"] },
        plugins: [
          [
            "formatjs",
            {
              idInterpolationPattern: "[sha512:contenthash:base64:6]",
              ast: true,
            },
          ],
        ],
      },
    }),
    react(),
  ],
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
