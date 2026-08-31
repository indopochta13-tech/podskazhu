/**
 * Проверка нужна ради одного: поймать обращение к тому, чего нет.
 * Такую опечатку не видно ни в тестах разбора речи, ни в API — она всплывает только на живом экране.
 */
import globals from "globals";

const rules = {
  "no-undef": "error",
  "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-unreachable": "error",
};

export default [
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules,
  },
  // Облако отдаётся в браузер как /cloud.js — те же глобалы, что у public/.
  {
    files: ["lib/cloud.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: globals.browser,
    },
    rules,
  },
  {
    files: ["*.js", "lib/**/*.js", "test/**/*.js"],
    ignores: ["lib/cloud.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: globals.node,
    },
    rules,
  },
];
