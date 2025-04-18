const axios = require('axios');
const pool = require('../../db/connection');
require('dotenv').config();

const registerUser = async (req, res) => {
    const { email, password, username } = req.body;

    try {
        //obtenemos el token de management api
        const tokenRes = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
            grant_type: "client_credentials",
            client_id: process.env.AUTH0_M2M_CLIENT_ID,
            client_secret: process.env.AUTH0_M2M_CLIENT_SECRET,
            audience: process.env.AUTH0_API_AUDIENCE,
        });

        const accessToken = tokenRes.data.access_token;

        // creamos un usuario
        const createRes = await axios.post(
            `https://${process.env.AUTH0_DOMAIN}/api/v2/users`,
            {
                email,
                password,
                connection: "Username-Password-Authentication",
                user_metadata: {
                    username
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,

                }
            }
        );

        const auth0_id = createRes.data.user_id;
        const nickname = createRes.data.nickname;
        const picture = createRes.data.picture;
        const name = createRes.data.name;

        // guardamios el usuario en la bd
        const dbRes = await pool.query(
            `INSERT INTO users (auth0_id, username, email, role, nickname, picture, name) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [auth0_id, username, email, 0, nickname, picture, name]
        );

        return res.status(201).json({ message: 'Usuario creado correctamente', user: dbRes.rows[0], });
    } catch (error) {
        console.error(error.response?.data || error.message);
        return res.status(500).json({
            message: 'Error al crear el usuario',
            error: error.response?.data || error.message,
        });
    }
};

module.exports = registerUser;