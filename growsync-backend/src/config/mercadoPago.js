const { MercadoPagoConfig } = require('mercadopago');

if (!process.env.MP_ACCESS_TOKEN) {
    throw new Error(
        "Falta configurar MP_ACCESS_TOKEN en las variables de entorno."
    );
}

const mercadoPagoConfig = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
    options: {
        timeout: 5000,
    },
});

module.exports = mercadoPagoConfig;