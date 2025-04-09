import axios from 'axios';

const API_URL = 'http://localhost:4000/api';

export const registerUser = async (data) => {
    const response = await axios.post(`${API_URL}/register`, data);
    return response.data;
};

export const loginUser = async (email, password) => {
    const response = await axios.post(`${API_URL}/login`, {
      email,
      password,
    });
    return response.data;
};