// IMPORTACION DE AXIOS, SUPABASE Y VARIABLES DE ENTORNO
const axios = require('axios');
const supabase = require('../../db/supabaseClient');
require('dotenv').config();

// DECLARAMOS UNA FUNCIÓN registerUser
const registerUser = async (req, res) => {
    const { email, password, username } = req.body; // OBTENEMOS MAIL Y CONTRASEÑA DEL CUERPO DEL REQUEST

    try {
        // 1️⃣ REALIZA UN POST A /oauth/token PARA GENERAR UN TOKEN DE ACCESO
        const tokenRes = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
            grant_type: "client_credentials",
            client_id: process.env.AUTH0_M2M_CLIENT_ID,
            client_secret: process.env.AUTH0_M2M_CLIENT_SECRET,
            audience: process.env.AUTH0_API_AUDIENCE,
        });

        const accessToken = tokenRes.data.access_token; // EXTRAEMOS EL TOKEN DE LA RESPUESTA

        // 2️⃣ CREA EL USUARIO EN AUTH0
        const createRes = await axios.post(
            `https://${process.env.AUTH0_DOMAIN}/api/v2/users`,
            {
                email,
                password,
                connection: "Username-Password-Authentication",
                user_metadata: { username }
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                }
            }
        );

        // 3️⃣ EXTRAER DATOS DEL USUARIO CREADO EN AUTH0
        const auth0_id = createRes.data.user_id;
        const nickname = createRes.data.nickname;
        const picture = createRes.data.picture;
        const name = createRes.data.name;

        // 4️⃣ GUARDAR EL USUARIO EN SUPABASE
        const { data, error } = await supabase
            .from('users')
            .insert([
                {
                    auth0_id,
                    username,
                    email,
                    role: 0, // Rol por defecto
                    nickname,
                    picture,
                    name
                }
            ])
            .select()
            .single(); // Esperamos un único registro

        if (error) {
            console.error("Error al insertar usuario en Supabase:", error);
            return res.status(500).json({ message: 'Error al guardar el usuario en la base de datos', error });
        }

        // 5️⃣ RESPUESTA EXITOSA
        return res.status(201).json({
            message: 'Usuario creado correctamente',
            user: data
        });

    } catch (error) {
        console.error(error.response?.data || error.message);
        return res.status(500).json({
            message: 'Error al crear el usuario',
            error: error.response?.data || error.message,
        });
    }
};

// EXPORTAMOS LA FUNCIÓN PARA SER USADA EN UNA RUTA
module.exports = registerUser;
