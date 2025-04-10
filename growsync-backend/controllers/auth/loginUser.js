const axios = require("axios");
require("dotenv").config();

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  // console.log("LOGIN DEBUG =>", {
  //   domain: process.env.AUTH0_DOMAIN,
  //   client_id: process.env.AUTH0_CLIENT_ID,
  //   client_secret: process.env.AUTH0_CLIENT_SECRET,
  //   realm: "Username-Password-Authentication",
  //   email,
  //   password
  // });  

  try {
    const response = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
      grant_type: "http://auth0.com/oauth/grant-type/password-realm",
      username: email,
      password,
      client_id: process.env.AUTH0_CLIENT_ID,
      client_secret: process.env.AUTH0_CLIENT_SECRET,
      scope: "openid profile email",
      realm: "Username-Password-Authentication"
    });        

    return res.status(200).json({
      access_token: response.data.access_token,
      token_type: response.data.token_type,
      expires_in: response.data.expires_in,
    });

  } catch (error) {
    console.error("Login error:", error.response?.data || error.message);
    return res.status(401).json({
      message: "Email o contraseña incorrectos",
      error: error.response?.data || error.message,
    });
  }
};

module.exports = loginUser;