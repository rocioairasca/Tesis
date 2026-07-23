const crypto = require('crypto');
const supabase = require('../db/supabaseClient');

const PLAN_CONFIG = {
  basic: {
    label: 'Basico',
    amount: 20000,
  },
  professional: {
    label: 'Profesional',
    amount: 45000,
  },
};

function generateTransactionNumber() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `GS-${timestamp}-${suffix}`;
}

function mapPayment(row) {
  if (!row) return null;
  return {
    ...row,
    plan_label: PLAN_CONFIG[row.plan]?.label || row.plan,
  };
}

exports.createSimulatedPayment = async (req, res) => {
  try {
    const { plan, payment_method } = req.body;
    const planConfig = PLAN_CONFIG[plan];

    if (!planConfig) {
      return res.status(400).json({
        error: 'InvalidPlan',
        message: 'Plan invalido',
      });
    }

    // Futuro Mercado Pago:
    // aca se podria crear una preferencia real y guardar el external_reference.
    const { data, error } = await supabase
      .from('payments')
      .insert({
        plan,
        amount: planConfig.amount,
        payment_method,
        transaction_number: generateTransactionNumber(),
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) throw error;

    return res.status(201).json({
      message: 'Pago simulado creado',
      payment: mapPayment(data),
    });
  } catch (error) {
    console.error('createSimulatedPayment error:', error);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'No se pudo crear el pago simulado',
    });
  }
};

exports.confirmSimulatedPayment = async (req, res) => {
  try {
    const { id } = req.params;

    // Futuro Mercado Pago:
    // aca se consultaria el estado real del pago antes de aprobarlo.
    const { data, error } = await supabase
      .from('payments')
      .update({ status: 'approved' })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Pago no encontrado',
      });
    }

    return res.json({
      message: 'Pago aprobado',
      payment: mapPayment(data),
    });
  } catch (error) {
    console.error('confirmSimulatedPayment error:', error);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'No se pudo confirmar el pago',
    });
  }
};

exports.getSimulatedPaymentById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Pago no encontrado',
      });
    }

    return res.json({ payment: mapPayment(data) });
  } catch (error) {
    console.error('getSimulatedPaymentById error:', error);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'No se pudo obtener el pago',
    });
  }
};
