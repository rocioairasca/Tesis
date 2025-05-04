// IMPORTACION DE MODULOS JWT Y VARIABLES DE ENTORNO
const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");
require("dotenv").config();

// DEFINIMOS Y CONFIGURAMOS EL MIDDLEWARE checkJwt
// Este se vale del modulo jwksRsa para obtener las claves publicas del servidor de auth0 para verificar los tokens que vienen encriptados en RS256
const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://dev-fl08rf2h5payxfcu.us.auth0.com/.well-known/jwks.json`,
  }),
  audience: process.env.AUTH0_API_AUDIENCE, 
  issuer: `https://dev-fl08rf2h5payxfcu.us.auth0.com/`,
  algorithms: ["RS256"],
});

// EXPORTAMOS EL MIDDLEWARE PARA PODER USARLO EN EL PROYECTO
module.exports = checkJwt;
