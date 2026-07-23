const crypto = require('crypto');
const { Preference, Payment } = require('mercadopago');
const mercadoPagoClient = require('../src/config/mercadoPago');

const preferenceClient = new Preference(mercadoPagoClient);
const paymentClient = new Payment(mercadoPagoClient);

const PLAN_CONFIG = {
  basic: {
    label: 'Plan Basico',
    amount: 20000,
  },
  professional: {
    label: 'Plan Profesional',
    amount: 45000,
  },
};

function isLocalReturnUrl(returnUrl) {
  try {
    const url = new URL(returnUrl);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

const createPaymentPreference = async (req, res) => {
  console.log('Entro al controller createPaymentPreference');

  try {
    const { plan } = req.body;
    const selectedPlan = PLAN_CONFIG[plan];

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

    console.log('Mercado Pago return URL:', {
      paymentReturnUrl,
      shouldAutoReturn,
    });

    const preferenceBody = {
      items: [
        {
          id: plan,
          title: `GrowSync - ${selectedPlan.label}`,
          description: 'Suscripcion a la plataforma GrowSync',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: selectedPlan.amount,
        },
      ],
      external_reference: externalReference,
      metadata: {
        plan,
        plan_label: selectedPlan.label,
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

    return res.status(201).json({
      message: 'Preferencia de pago creada correctamente',
      preference: {
        id: preferenceResponse.id,
        externalReference,
        checkoutUrl:
          preferenceResponse.init_point ||
          preferenceResponse.sandbox_init_point,
        plan,
        planLabel: selectedPlan.label,
        amount: selectedPlan.amount,
        currency: 'ARS',
      },
    });
  } catch (error) {
    console.error('Error al crear preferencia de Mercado Pago:', {
      message: error.message,
      status: error.status,
      cause: error.cause,
    });

    return res.status(500).json({
      message: 'No se pudo iniciar el pago',
      error: error.message,
      status: error.status,
    });
  }
};

const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;

    if (!paymentId) {
      return res.status(400).json({
        message: 'Falta el identificador del pago',
      });
    }

    const payment = await paymentClient.get({
      id: paymentId,
    });

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
    console.error('Error al consultar el pago', error);

    return res.status(500).json({
      message: 'No se pudo consultar el pago',
      error: error.message,
      status: error.status,
    });
  }
};

const getPaymentByReference = async (req, res) => {
  try {
    const { externalReference } = req.params;

    if (!externalReference) {
      return res.status(400).json({
        message: 'Falta la referencia del pago',
      });
    }

    const searchResponse = await paymentClient.search({
      options: {
        external_reference: externalReference,
      },
    });

    const payments = searchResponse.results || [];
    const payment = payments[0];

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
      message: error.message,
      status: error.status,
      cause: error.cause,
    });

    return res.status(500).json({
      message: 'No se pudo consultar el estado del pago',
      error: error.message,
      status: error.status,
    });
  }
};

module.exports = {
  createPaymentPreference,
  getPaymentStatus,
  getPaymentByReference,
};
