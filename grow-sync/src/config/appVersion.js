export const APP_VERSION =
    typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export const APP_VERSION_LABEL = `Versión ${APP_VERSION}`;

export const SHOULD_CHECK_APP_VERSION =
    !import.meta.env.DEV && APP_VERSION !== "dev";
