import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import ts from "typescript-eslint";

export default ts.config(
    { ignores: ["dist/", "legacy/", "node_modules/"] },
    js.configs.recommended,
    ts.configs.recommended,
    // Правила ширины и отступов оставлены Prettier: два судьи по одному вопросу
    // спорят друг с другом.
    prettier,
    {
        rules: {
            // Подчёркивание — принятая в проекте пометка «параметр не нужен»:
            // так объявлены пустые шаги BaseLayer.
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
            ],
            eqeqeq: ["error", "smart"],
            "no-console": ["warn", { allow: ["warn", "error"] }],
            "prefer-const": "error"
        }
    },
    {
        files: ["scripts/**/*.mjs"],
        languageOptions: {
            globals: {
                console: "readonly",
                process: "readonly",
                fetch: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                WebSocket: "readonly"
            }
        },
        rules: { "no-console": "off" }
    }
);
