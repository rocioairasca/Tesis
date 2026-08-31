import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const getAppVersion = (command) => {
    const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;

    if (commitSha) {
        return commitSha.slice(0, 7);
    }

    if (command === "build") {
        return new Date()
            .toISOString()
            .replace(/[-:.TZ]/g, "")
            .slice(0, 14);
    }

    return "dev";
};

const appVersionPlugin = (version) => ({
    name: "growsync-app-version",
    apply: "build",
    generateBundle() {
        this.emitFile({
            type: "asset",
            fileName: "version.json",
            source: `${JSON.stringify({ version }, null, 2)}\n`,
        });
    },
});

export default defineConfig(({ command }) => {
    const appVersion = getAppVersion(command);

    return {
        plugins: [react(), appVersionPlugin(appVersion)],
        define: {
            __APP_VERSION__: JSON.stringify(appVersion),
        },
        server: {
            port: 3000,
        },
    };
});
