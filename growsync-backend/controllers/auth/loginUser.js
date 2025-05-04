// IMPORTACION DE AXIOS Y VARIABLES DE ENTORNO
const axios = require("axios");
require("dotenv").config();

// DECLARAMOS UNA FUNCION loginUser
const loginUser = async (req, res) => {
  const { email, password } = req.body;   // OBTENEMOS MAIL Y CONTRASEÑA DEL CUERPO DEL REQUEST

  try { // REALIZA UN POST A /oauth/token PARA GENERAR TOKENS DE ACCESO
    const response = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {  
      grant_type: "http://auth0.com/oauth/grant-type/password-realm",
      username: email,
      password,
      audience: process.env.AUTH0_API_AUDIENCE,
      client_id: process.env.AUTH0_CLIENT_ID,
      client_secret: process.env.AUTH0_CLIENT_SECRET,
      scope: "openid profile email",
      realm: "Username-Password-Authentication"
    });        

    return res.status(200).json({ // SI LA AUTENTICACION ES EXITOSA, DEVUELVE LOS TOKENS GENERADOS
      access_token: response.data.access_token,
      id_token: response.data.id_token,
      token_type: response.data.token_type,
      expires_in: response.data.expires_in,
    });

  } catch (error) {  // SI OCURRE UN ERROR, LO MUESTRA EN CONSOLA O AVISA QUE LAS CREDENCIALES SON INVALIDAS (error 401 - unauthorized)
    console.error("Login error:", error.response?.data || error.message);
    return res.status(401).json({
      message: "Email o contraseña incorrectos",
      error: error.response?.data || error.message,
    });
  }
};

// EXPORTAMOS LA FUNCION PARA SER USADA EN UNA RUTA (routes/auth.js) O EN EL FRONT
module.exports = loginUser;