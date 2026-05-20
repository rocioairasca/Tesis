import axios from "axios";
import { getApiBaseUrl } from "./apiBase";

const api = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: false, // no enviamos cookies, solo Bearer
});

// Interceptor para inyectar Authorization
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Aseguramos Content-Type para POST/PUT/PATCH
    if (
      ["post", "put", "patch"].includes(config.method) &&
      !config.headers["Content-Type"]
    ) {
      config.headers["Content-Type"] = "application/json";
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default api;
