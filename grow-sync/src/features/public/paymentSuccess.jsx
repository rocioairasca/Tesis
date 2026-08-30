import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Result,
  Button,
  Card,
  Descriptions,
  Spin,
  Alert,
} from "antd";
import { getMercadoPagoPaymentStatus } from "../../services/publicService";
import { getUserFriendlyError } from "../../utils/userFriendlyErrors";

const PaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");

  const paymentId = searchParams.get("payment_id");

  useEffect(() => {
    const verifyPayment = async () => {
      if (!paymentId) {
        setError("Mercado Pago no proporcionó el identificador del pago.");
        setLoading(false);
        return;
      }

      try {
        const response = await getMercadoPagoPaymentStatus(paymentId);

        setPayment(response.payment);

        if (response.payment?.externalReference) {
          localStorage.setItem(
            "growsync_mp_external_reference",
            response.payment.externalReference
          );
        }
      } catch (requestError) {
        console.error("Error al verificar el pago:", requestError);

        setError(
          getUserFriendlyError(requestError, "No se pudo verificar el pago.")
        );
      } finally {
        setLoading(false);
      }
    };

    verifyPayment();
  }, [paymentId]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Spin size="large" tip="Verificando pago..." />
      </div>
    );
  }

  if (error) {
    return (
      <Result
        status="error"
        title="No pudimos verificar el pago"
        subTitle={error}
        extra={[
          <Button
            key="plans"
            type="primary"
            onClick={() => navigate("/")}
          >
            Volver
          </Button>,
        ]}
      />
    );
  }

  const approved = payment?.status === "approved";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F3D8",
        padding: "40px 16px",
      }}
    >
      <Card
        style={{
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <Result
          status={approved ? "success" : "info"}
          title={
            approved
              ? "Pago aprobado correctamente"
              : "Pago recibido"
          }
          subTitle={
            approved
              ? "Tu pago fue acreditado por Mercado Pago."
              : "El pago todavía está siendo procesado."
          }
        />

        <Descriptions bordered column={1}>
          <Descriptions.Item label="Número de pago">
            {payment?.id}
          </Descriptions.Item>

          <Descriptions.Item label="Plan">
            {payment?.planLabel || payment?.plan || "Sin especificar"}
          </Descriptions.Item>

          <Descriptions.Item label="Importe">
            {new Intl.NumberFormat("es-AR", {
              style: "currency",
              currency: payment?.currency || "ARS",
            }).format(payment?.amount || 0)}
          </Descriptions.Item>

          <Descriptions.Item label="Estado">
            {payment?.status}
          </Descriptions.Item>

          <Descriptions.Item label="Detalle">
            {payment?.statusDetail}
          </Descriptions.Item>

          <Descriptions.Item label="Medio de pago">
            {payment?.paymentMethod || "No informado"}
          </Descriptions.Item>

          <Descriptions.Item label="Fecha de aprobación">
            {payment?.dateApproved
              ? new Date(payment.dateApproved).toLocaleString("es-AR")
              : "Pendiente"}
          </Descriptions.Item>
        </Descriptions>

        {!approved && (
          <Alert
            style={{ marginTop: 24 }}
            type="info"
            showIcon
            message="El pago todavía no figura como aprobado."
          />
        )}

        <div
          style={{
            marginTop: 24,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Button
            type="primary"
            disabled={!approved || !payment?.externalReference}
            onClick={() =>
              navigate(
                `/register-company?externalReference=${encodeURIComponent(
                  payment.externalReference
                )}`
              )
            }
          >
            Continuar al registro
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default PaymentSuccess;
