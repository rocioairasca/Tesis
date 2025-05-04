// IMPORTACION DE AXIOS, POOL DE BD Y VARIABLES DE ENTORNO
const axios = require('axios');
const pool = require('../../db/connection');
require('dotenv').config();

// DECLARAMOS UNA FUNCION registerUser
const registerUser = async (req, res) => {
    const { email, password, username } = req.body; // OBTENEMOS MAIL Y CONTRASEÑA DEL CUERPO DEL REQUEST

    try { // REALIZA UN POST A /oauth/token PARA GENERAR UN TOKEN DE ACCESO
        const tokenRes = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
            grant_type: "client_credentials",
            client_id: process.env.AUTH0_M2M_CLIENT_ID,
            client_secret: process.env.AUTH0_M2M_CLIENT_SECRET,
            audience: process.env.AUTH0_API_AUDIENCE,
        });

        const accessToken = tokenRes.data.access_token; // EXTRAEMOS EL TOKEN QUE VIENE DENTRO DE LA RESPUESTA

        const createRes = await axios.post( // USA ESE MISMO TOKEN PARA GENERAR UN NUEVO USUARIO DESDE LA Management API de Auth0
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

        // SE EXTRAEN DATOS UTILES DEL USUARIO RECIEN CREADO
        const auth0_id = createRes.data.user_id;
        const nickname = createRes.data.nickname;
        const picture = createRes.data.picture;
        const name = createRes.data.name;

        // Y LO GUARDAMOS EN LA BD (El rol se establece en 0 por defecto)
        const dbRes = await pool.query(
            `INSERT INTO users (auth0_id, username, email, role, nickname, picture, name) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [auth0_id, username, email, 0, nickname, picture, name]
        );

        // EN CASO DE EXITO, NOS RESPONDE CON LOS DATOS DEL USUARIO GENERADO
        return res.status(201).json({ message: 'Usuario creado correctamente', user: dbRes.rows[0], });
        
    } catch (error) { // EN CASO DE ERROR (ya se en BD o Auth0), NOS DEVUELVE INFORMACION AL RESPECTO
        console.error(error.response?.data || error.message);
        return res.status(500).json({
            message: 'Error al crear el usuario',
            error: error.response?.data || error.message,
        });
    }
};

// EXPORTAMOS LA FUNCION PARA SER USADA EN UNA RUTA (routes/auth.js) O EN EL FRONT
module.exports = registerUser;