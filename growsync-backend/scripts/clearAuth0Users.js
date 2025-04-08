const axios = require('axios');
require('dotenv').config();

const deleteAllAuth0Users = async () => {
    try {
        // obtener el token :P
        const tokenRes = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
            client_id: process.env.AUTH0_CLIENT_ID,
            client_secret: process.env.AUTH0_CLIENT_SECRET,
            audience: process.env.AUTH0_API_AUDIENCE,
            grant_type: 'client_credentials',
        });

        const accessToken = tokenRes.data.access_token;

        // obtener todos los usuariosss
        const usersRes = await axios.get(
            `https://${process.env.AUTH0_DOMAIN}/api/v2/users`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        const users = usersRes.data;

        if(!users.length) {
            console.log("No hay usuarios para eliminar.");
            return;
        }

        //eliminamos uno por uno :c

        for (const user of users) {
            await axios.delete(
                `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(user.user_id)}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                }
            );
            console.log(`Usuario ${user.email} eliminado.`);
        }

        console.log('Todos los usuarios eliminados.');
    } catch (error) {
        console.error('Error al eliminar usuarios:', error.response?.data || error.message);
    }
};

deleteAllAuth0Users();