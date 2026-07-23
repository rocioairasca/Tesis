const supabase = require("../db/supabaseClient");
const axios = require("axios");
const { Payment } = require("mercadopago");
const mercadoPagoClient = require("../src/config/mercadoPago");

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_M2M_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_M2M_CLIENT_SECRET;
const mercadoPagoPaymentClient = new Payment(mercadoPagoClient);

const getAuth0ManagementToken = async () => {
  const { data } = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
    client_id: AUTH0_CLIENT_ID,
    client_secret: AUTH0_CLIENT_SECRET,
    audience: `https://${AUTH0_DOMAIN}/api/v2/`,
    grant_type: "client_credentials",
  });

  return data.access_token;
};

exports.registerCompany = async (req, res) => {
  try {
    const {
      companyName,
      adminName,
      email,
      password,
      paymentId,
      mercadoPagoExternalReference,
    } = req.body;

    if (
      !companyName ||
      !adminName ||
      !email ||
      !password ||
      (!paymentId && !mercadoPagoExternalReference)
    ) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Faltan datos obligatorios",
      });
    }

    let paymentApproved = false;

    if (paymentId) {
      const { data: payment, error: paymentError } = await supabase
        .from("payments")
        .select("id,status")
        .eq("id", paymentId)
        .maybeSingle();

      if (paymentError) throw paymentError;

      paymentApproved = payment?.status === "approved";
    } else {
      const searchResponse = await mercadoPagoPaymentClient.search({
        options: {
          external_reference: mercadoPagoExternalReference,
        },
      });

      const mercadoPagoPayment = searchResponse.results?.[0];
      paymentApproved = mercadoPagoPayment?.status === "approved";
    }

    if (!paymentApproved) {
      return res.status(402).json({
        error: "PaymentRequired",
        message: "Debes confirmar el pago antes de registrar la empresa",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return res.status(409).json({
        error: "Conflict",
        message: "Ya existe un usuario con ese email",
      });
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .insert({
        name: companyName.trim(),
      })
      .select()
      .single();

    if (companyError) throw companyError;

    const managementToken = await getAuth0ManagementToken();

    const { data: auth0User } = await axios.post(
      `https://${AUTH0_DOMAIN}/api/v2/users`,
      {
        email: normalizedEmail,
        password,
        name: adminName,
        connection: "Username-Password-Authentication",
        email_verified: false,
      },
      {
        headers: {
          Authorization: `Bearer ${managementToken}`,
        },
      }
    );

    const { error: userError } = await supabase.from("users").insert({
      email: normalizedEmail,
      full_name: adminName.trim(),
      role: 3,
      enabled: true,
      company_id: company.id,
      auth0_id: auth0User.user_id,
    });

    if (userError) throw userError;

    return res.status(201).json({
      message: "Empresa y administrador creados correctamente",
      company,
    });
  } catch (error) {
    console.error("Error registerCompany:", error?.response?.data || error);

    return res.status(500).json({
      error: "InternalServerError",
      message: "No se pudo registrar la empresa",
    });
  }
};
