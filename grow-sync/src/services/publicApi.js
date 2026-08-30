import axios from 'axios';
import { getApiBaseUrl } from "./apiBase";
import { enrichUserFriendlyError } from "../utils/userFriendlyErrors";

const publicApi = axios.create({
    baseURL: getApiBaseUrl(),
        withCredentials: false,
        headers: {
            "Content-Type": "application/json",
        },
});

publicApi.interceptors.request.use((config) => {
    const finalUrl = new URL(
        config.url || "",
        config.baseURL || window.location.origin
    ).toString();

    console.log("[publicApi] Request", {
        method: config.method?.toUpperCase(),
        baseURL: config.baseURL,
        url: config.url,
        finalUrl,
        hasAuthorization: Boolean(config.headers?.Authorization),
    });

    return config;
});

publicApi.interceptors.response.use(
    (response) => response,
    (error) => Promise.reject(enrichUserFriendlyError(error))
);

export default publicApi;
