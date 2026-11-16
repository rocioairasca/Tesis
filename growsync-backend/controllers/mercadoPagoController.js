const intents = require('../services/registrationIntents');
const crypto = require('crypto');
const { Preference, Payment } = require('mercadopago');
const mercadoPagoClient = require('../src/config/mercadoPago');

const preferenceClient = new Preference(mercadoPagoClient);
const paymentClient = new Payment(mercadoPagoClient);

const { PLAN_CONFIG } = require('../services/registrationPayments');
const { pool } = require('../db/supabaseClient');

function isLocalReturnUrl(returnUrl) {
  try {
    const url = new URL(returnUrl);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

const createPaymentPreference = async (req, res) => {
  res.set('Cache-Control', 'no-store');

  try {
    if (!pool) return res.status(503).json({ message: 'El registro no está disponible temporalmente' });
    const { plan } = req.body;
    const selectedPlan = Object.hasOwn(PLAN_CONFIG, plan) ? PLAN_CONFIG[plan] : null;

    if (!selectedPlan) {
      return res.status(400).json({
        message: 'El plan seleccionado no es valido',
      });
    }

    const externalReference = crypto.randomUUID();
    const requestOrigin = req.get('origin');
    const frontendUrl = (
      requestOrigin ||
      process.env.FRONTEND_URL ||
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    const paymentReturnUrl = `${frontendUrl}/payment?${new URLSearchParams({
      plan,
      externalReference,
    }).toString()}`;
    const shouldAutoReturn = !isLocalReturnUrl(paymentReturnUrl);

    const preferenceBody = {
      items: [
        {
          id: plan,
          title: `GrowSync - Plan ${selectedPlan.label}`,
          description: 'Suscripcion a la plataforma GrowSync',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: selectedPlan.amount,
        },
      ],
      external_reference: externalReference,
      metadata: {
        plan,
        plan_label: `Plan ${selectedPlan.label}`,
      },
      back_urls: {
        success: paymentReturnUrl,
        pending: paymentReturnUrl,
        failure: paymentReturnUrl,
      },
    };

    if (shouldAutoReturn) {
      preferenceBody.auto_return = 'approved';
    }

    const preferenceResponse = await preferenceClient.create({
      body: preferenceBody,
    });

    const { registrationToken, registrationTokenHash } = intents.issue();
    // The private secret is never included in the Mercado Pago request or checkout URL.
    // Persist server-owned terms before exposing a checkout URL to the browser.
    await pool.query(`INSERT INTO public.company_registration_payments
      (provider,reference,preference_id,plan,amount,currency,registration_token_hash)
      VALUES ('mercadopago',$1,$2,$3,$4,'ARS',$5)`,
    [externalReference, preferenceResponse.id, plan, selectedPlan.amount, registrationTokenHash]);

    return res.status(201).json({
      message: 'Preferencia de pago creada correctamente',
      registrationToken,
      preference: {
        id: preferenceResponse.id,
        externalReference,
        checkoutUrl:
          preferenceResponse.init_point ||
          preferenceResponse.sandbox_init_point,
        plan,
        planLabel: `Plan ${selectedPlan.label}`,
        amount: selectedPlan.amount,
        currency: 'ARS',
      },
    });
  } catch (error) {
    console.error('Error al crear preferencia de Mercado Pago:', {
      status: error.status,
    });

    return res.status(500).json({
      message: 'No se pudo iniciar el pago',
    });
  }
};

const getPaymentStatus = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { paymentId } = req.params;

    if (!paymentId) {
      return res.status(400).json({
        message: 'Falta el identificador del pago',
      });
    }

    const intent = await intents.validate(pool, {
      provider: 'mercadopago', reference: req.get('X-Registration-Reference'),
      registrationToken: req.get('X-Registration-Token'),
    });
    const payment = await paymentClient.get({ id: paymentId });
    if (payment.external_reference !== intent.reference) throw intents.denied();

    return res.status(200).json({
      message: 'Pago consultado correctamente',
      payment: {
        id: payment.id,
        status: payment.status,
        statusDetail: payment.status_detail,
        externalReference: payment.external_reference,
        amount: payment.transaction_amount,
        currency: payment.currency_id,
        dateApproved: payment.date_approved,
        paymentMethod: payment.payment_method_id,
        paymentType: payment.payment_type_id,
        plan: payment.metadata?.plan,
        planLabel: payment.metadata?.plan_label,
      },
    });
  } catch (error) {
    console.error('Error al consultar el pago', { status: error.status });

    if ([403,409,503].includes(error.status)) return res.status(error.status).json({ message: error.message });
    return res.status(500).json({
      message: 'No se pudo consultar el pago',
    });
  }
};

const getPaymentByReference = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { externalReference } = req.params;

    if (!externalReference) {
      return res.status(400).json({
        message: 'Falta la referencia del pago',
      });
    }

    await intents.validate(pool, { provider: 'mercadopago', reference: externalReference,
      registrationToken: req.get('X-Registration-Token') });
    const searchResponse = await paymentClient.search({
      options: {
        external_reference: externalReference,
      },
    });

    const payments = searchResponse.results || [];
    const payment = payments.find(item => item.external_reference === externalReference);

    if (!payment) {
      return res.status(200).json({
        found: false,
        payment: null,
      });
    }

    return res.status(200).json({
      found: true,
      payment: {
        id: payment.id,
        status: payment.status,
        statusDetail: payment.status_detail,
        externalReference: payment.external_reference,
        amount: payment.transaction_amount,
        currency: payment.currency_id,
        dateApproved: payment.date_approved,
        paymentMethod: payment.payment_method_id,
        paymentType: payment.payment_type_id,
        plan: payment.metadata?.plan,
        planLabel: payment.metadata?.plan_label,
      },
    });
  } catch (error) {
    console.error('Error al buscar pago por referencia:', {
      status: error.status,
    });

    if ([403,409,503].includes(error.status)) return res.status(error.status).json({ message: error.message });
    return res.status(500).json({
      message: 'No se pudo consultar el estado del pago',
    });
  }
};

module.exports = {
  createPaymentPreference,
  getPaymentStatus,
  getPaymentByReference,
};
