import axios from 'axios';

const API_URL = 'http://localhost:4000/api';

export const registerUser = async (data) => {
    const response = await axios.post(`${API_URL}/register`, data);
    return response.data;
};

export const loginUser = async (userData) => {
  const response = await axios.post(`${API_URL}/login`, userData, {
    params: {
      audience: 'https://dev-fl08rf2h5payxfcu.us.auth0.com/api/v2/' 
    }
  });
  return response.data;
};

export const getUserDataByEmail = async (email) => {
  const res = await axios.get(`${API_URL}/users/email/${email}`);
  return res.data;
};

