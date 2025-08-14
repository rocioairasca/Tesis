import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:4000/api",
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
