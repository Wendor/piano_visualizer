import { defineConfig } from "vite";

export default defineConfig({
    base: "./",
    server: { port: 5180, host: "0.0.0.0" },
    build: { target: "es2022", outDir: "dist" }
});
