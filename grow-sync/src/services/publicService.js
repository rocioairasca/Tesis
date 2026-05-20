import api from "./apiClient";

export const registerCompany = async (payload) => {
  const { data } = await api.post(
    "/public/register-company",
    payload
  );

  return data;
};