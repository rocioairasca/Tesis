import React, { useEffect, useState } from "react";
import { Button, Card, Col, Descriptions, Radio, Row, Space, Tag, Typography, notification } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Leaf } from "../../components/AppIcons";
import { createMercadoPagoPreference, getMercadoPagoPaymentByReference } from "../../services/publicService";
import { QRCodeSVG } from "qrcode.react";
import jsPDF from 'jspdf';

const { Title, Paragraph, Text } = Typography;

const planConfig = {
  basic: { label: "Basico", amount: 20000 },
  professional: { label: "Profesional", amount: 45000 },
};

const paymentMethodLabels = {
  qr: "Código QR",
  card: "Tarjeta",
  transfer: "Transferencia bancaria",
};

const paymentStatusConfig = {
  not_started: {
    color: "default",
    label: "Sin iniciar",
  },
  pending: {
    color: "processing",
    label: "Esperando pago",
  },
  in_process: {
    color: "warning",
    label: "Pago en proceso",
  },
  approved: {
    color: "success",
    label: "Pago aprobado",
  },
  rejected: {
    color: "error",
    label: "Pago rechazado",
  },
  cancelled: {
    color: "default",
    label: "Pago cancelado",
  },
};

const formatMoney = (value) => value.toLocaleString("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const PaymentSimulation = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const selectedPlan = searchParams.get("plan");
  const returnedExternalReference = searchParams.get("externalReference");
  const plan = planConfig[selectedPlan];

  const [paymentMethod] = useState("qr");
  const [preference, setPreference] = useState(null);
  const [loading, setLoading] = useState(false);

  const [paymentStatus, setPaymentStatus] = useState("pending");
  const [paymentData, setPaymentData] = useState(null);

  const checkoutUrl = preference?.checkoutUrl || "";

  const externalReference =
    preference?.externalReference || returnedExternalReference || "";
  const isApproved = paymentStatus === "approved";
  const currentStatus = paymentStatusConfig[paymentStatus] || paymentStatusConfig.not_started;

  const handleCreatePreference = async () => {
    try {
      setLoading(true);

      setPaymentStatus("pending");
      setPaymentData(null);
      setPreference(null);
      localStorage.removeItem("growsync_mp_external_reference");
      localStorage.removeItem("growsync_mp_preference_id");

      const result = await createMercadoPagoPreference({
        plan: selectedPlan,
      });

      console.log("Preferencia recibida:", result);

      if (!result?.preference?.checkoutUrl) {
        throw new Error(
          "El backend no devolvió una URL de pago válida"
        );
      }

      setPreference(result.preference);

      localStorage.setItem(
        "growsync_mp_external_reference",
        result.preference.externalReference
      );

      localStorage.setItem(
        "growsync_mp_preference_id",
        result.preference.id
      );

      notification.success({
        message: "Código QR generado",
        description:
          "Escaneá con tu celular para continuar con el pago.",
      });
    } catch (error) {
      console.error(
        "Error al crear la preferencia de pago:",
        error
      );

      notification.error({
        message:
          error?.response?.data?.message ||
          error?.message ||
          "No se pudo generar el código de pago.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReceipt = () => {
    if (!isApproved || !paymentData) {
      notification.warning({
        message: "Comprobante no disponible",
        description:
          "El comprobante solo está disponible cuando el pago ha sido aprobado.",
      });

      return;
      
    }

    const doc = new jsPDF();

    const paymentDate = paymentData.dateApproved
      ? new Date(paymentData.dateApproved).toLocaleString("es-AR")
      : "No informada";


    const planLabel =
      paymentData.planLabel ||
      plan?.label ||
      paymentData.plan ||
      "No informado";

    const amount = formatMoney(
      paymentData.amount || plan?.amount || 0
    );

    const paymentMethod = 
      paymentData.paymentMethod || "No informado";

    
    const reference = 
      paymentData.externalReference ||
      externalReference ||
      "No informada";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("GrowSync", 20, 25);

    doc.setFontSize(15);
    doc.text("Comprobante de pago", 20, 38);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      "Comprobante informativo generado por GrowSync.",
      20,
      47
    );

    doc.line(20, 54, 190, 54);

    doc.setFontSize(11);

    const rows = [
      ["Estado", "Pago aprobado"],
      ["Plan", planLabel],
      ["Importe", amount],
      ["Número de pago", String(paymentData.id)],
      ["Referencia GrowSync", reference],
      ["Fecha de aprobación", paymentDate],
      ["Medio de pago", paymentMethod],
      [
        "Detalle del estado",
        paymentData.statusDetail || "Acreditado",
      ],
    ];

    let y = 67;

    rows.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(`${label}:`, 20, y);

      doc.setFont("helvetica", "normal");

      const valueLines = doc.splitTextToSize(
        String(value),
        110
      );

      doc.text(valueLines, 75, y);

      y += Math.max(9, valueLines.length * 6);
    });

    doc.line(20, y + 2, 190, y + 2);

    doc.setFontSize(9);
    doc.text(
      "Este documento no reemplaza el comprobante emitido por Mercado Pago ni constituye una factura.",
      20,
      y + 12,
      {
        maxWidth: 170,
      }
    );

    const safePlan = String(
      paymentData.plan || selectedPlan || "plan"
    )
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-");

    const safePaymentId = String(paymentData.id);

    const fileName =
      `comprobante-growsync-${safePlan}-${safePaymentId}.pdf`;

    doc.save(fileName);

  };

  useEffect(() => {
    if (!externalReference) return;

    localStorage.setItem(
      "growsync_mp_external_reference",
      externalReference
    );

    const checkPayment = async () => {
      try {
        const result =
          await getMercadoPagoPaymentByReference(
            externalReference
          );

        if (!result.found) {
          setPaymentStatus("pending");
          return;
        }

        setPaymentData(result.payment);
        setPaymentStatus(result.payment.status);
      } catch (error) {
        console.error(error);
      }
    };

    checkPayment();

    const interval = setInterval(
      checkPayment,
      5000
    );

    return () => clearInterval(interval);
  }, [externalReference]);

  console.log("PaymentSimulation renderizado", {
    selectedPlan,
    plan,
  });

  if (!plan) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f5f7fa",
          padding: "32px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Card style={{ width: "100%", maxWidth: 480 }}>
          <Space
            direction="vertical"
            size={16}
            style={{ width: "100%", textAlign: "center" }}
          >
            <Title level={3}>Plan no encontrado</Title>

            <Paragraph type="secondary">
              El plan seleccionado no existe o no es válido.
            </Paragraph>

            <Text type="secondary">
              Valor recibido: {selectedPlan || "ninguno"}
            </Text>

            <Button
              type="primary"
              onClick={() => navigate("/planes")}
            >
              Volver a elegir un plan
            </Button>
          </Space>
        </Card>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f7fa",
        padding: "32px 16px",
      }}
    >
      <Row justify="center">
        <Col xs={24} lg={18} xl={14}>
          <Space
            direction="vertical"
            size={24}
            style={{ width: "100%" }}
          >
            <div style={{ textAlign: "center" }}>
              <Leaf
                size={40}
                style={{
                  color: "#437118",
                  marginBottom: 8,
                }}
              />

              <Title
                level={2}
                style={{
                  marginTop: 0,
                  marginBottom: 4,
                }}
              >
                Finalizar compra
              </Title>

              <Paragraph
                type="secondary"
                style={{ marginBottom: 4 }}
              >
                Aboná tu suscripción mediante Mercado Pago.
              </Paragraph>

              <Text
                type="secondary"
                style={{ fontSize: 12 }}
              >
                Entorno de demostración: no se realizarán cargos
                reales.
              </Text>
            </div>

            <Row gutter={[20, 20]}>
              <Col xs={24} md={14}>
                <Card
                  title="Medio de pago"
                  bordered={false}
                  style={{ borderRadius: 8 }}
                >
                  <Space
                    direction="vertical"
                    size={20}
                    style={{ width: "100%" }}
                  >
                    <Radio.Group value={paymentMethod}>
                      <Radio value="qr">
                        Mercado Pago mediante código QR
                      </Radio>
                    </Radio.Group>

                    <div
                      style={{
                        borderTop: "1px solid #f0f0f0",
                      }}
                    />

                    <Space
                      direction="vertical"
                      align="center"
                      size={12}
                      style={{ width: "100%" }}
                    >
                      {isApproved ? (
                        <>
                          <div
                            style={{
                              width: 220,
                              height: 220,
                              border: "1px solid #b7eb8f",
                              borderRadius: 8,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "#f6ffed",
                              padding: 24,
                            }}
                          >
                            <Space
                              direction="vertical"
                              align="center"
                              size={8}
                            >
                              <Tag color="success">Pago aprobado</Tag>
                              <Text style={{ textAlign: "center" }}>
                                Ya podés descargar el comprobante y
                                continuar al registro.
                              </Text>
                            </Space>
                          </div>
                        </>
                      ) : !checkoutUrl ? (
                        <>
                          <div
                            style={{
                              width: 220,
                              height: 220,
                              border: "1px dashed #d9d9d9",
                              borderRadius: 8,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "#fafafa",
                              padding: 24,
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{ textAlign: "center" }}
                            >
                              Generá el código QR para iniciar el
                              pago.
                            </Text>
                          </div>

                          <Button
                            type="primary"
                            size="large"
                            loading={loading}
                            onClick={handleCreatePreference}
                          >
                            Generar código QR
                          </Button>
                        </>
                      ) : (
                        <>
                          <div
                            style={{
                              padding: 16,
                              background: "#ffffff",
                              border: "1px solid #e5e7eb",
                              borderRadius: 8,
                            }}
                          >
                            <QRCodeSVG
                              value={checkoutUrl}
                              size={190}
                              bgColor="#ffffff"
                              fgColor="#111827"
                              level="M"
                              marginSize={1}
                              title="Código QR de Mercado Pago"
                            />
                          </div>

                          <Text strong>
                            Escaneá el código con tu celular
                          </Text>

                          <Text
                            type="secondary"
                            style={{
                              textAlign: "center",
                              maxWidth: 300,
                            }}
                          >
                            El enlace abrirá el entorno de pago de
                            Mercado Pago.
                          </Text>

                          <Button
                            type="link"
                            href={checkoutUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Abrir Mercado Pago en este dispositivo
                          </Button>

                          <Button
                            onClick={handleCreatePreference}
                            loading={loading}
                          >
                            Generar un código nuevo
                          </Button>
                        </>
                      )}
                    </Space>
                  </Space>
                </Card>
              </Col>

              <Col xs={24} md={10}>
                <Card
                  title="Resumen"
                  bordered={false}
                  style={{ borderRadius: 8 }}
                >
                  <Space
                    direction="vertical"
                    size={16}
                    style={{ width: "100%" }}
                  >
                    <Descriptions
                      column={1}
                      size="small"
                      colon={false}
                    >
                      <Descriptions.Item label="Plan">
                        {plan.label}
                      </Descriptions.Item>

                      <Descriptions.Item label="Importe">
                        {formatMoney(plan.amount)}
                      </Descriptions.Item>

                      <Descriptions.Item label="Método">
                        {paymentMethodLabels[paymentMethod]}
                      </Descriptions.Item>

                      <Descriptions.Item label="Estado">
                        <Tag color={currentStatus.color}>
                          {currentStatus.label}
                        </Tag>
                      </Descriptions.Item>

                      {externalReference && (
                        <Descriptions.Item label="Referencia">
                          <Text
                            copyable={{
                              text: externalReference,
                            }}
                            ellipsis
                            style={{
                              display: "inline-block",
                              maxWidth: 180,
                            }}
                          >
                            {externalReference}
                          </Text>
                        </Descriptions.Item>
                      )}

                      {paymentData?.id && (
                        <Descriptions.Item label="N° de pago">
                          {paymentData.id}
                        </Descriptions.Item>
                      )}
                    </Descriptions>

                    <div
                      style={{
                        borderTop: "1px solid #f0f0f0",
                      }}
                    />

                    <Text
                      type="secondary"
                      style={{ fontSize: 12 }}
                    >
                      {isApproved
                        ? "Pago confirmado. Ya podés descargar el comprobante y continuar."
                        : "El comprobante y el registro de empresa se habilitarán cuando GrowSync reciba la confirmación del pago."}
                    </Text>

                    <Button
                      disabled={!isApproved}
                      block
                      onClick={handleDownloadReceipt}
                    >
                      Descargar comprobante
                    </Button>

                      <Button
                        type="primary"
                        disabled={!isApproved}
                        block
                        onClick={() =>
                        navigate(
                          `/register-company?externalReference=${encodeURIComponent(
                            externalReference
                          )}`
                        )
                      }
                    >
                      Continuar al registro de empresa
                    </Button>
                  </Space>
                </Card>
              </Col>
            </Row>
          </Space>
        </Col>
      </Row>
    </div>
  );
};

export default PaymentSimulation;
