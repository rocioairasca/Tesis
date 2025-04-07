const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `https://dev-fl08rf2h5payxfcu.us.auth0.com/.well-known/jwks.json`,
  }),
  audience: "TU_API_IDENTIFIER", // lo definís en Auth0
  issuer: `https://dev-fl08rf2h5payxfcu.us.auth0.com/`,
  algorithms: ["RS256"],
});

// Usalo en rutas protegidas:
app.get("/perfil", checkJwt, (req, res) => {
  res.send("Ruta protegida ✔");
});
