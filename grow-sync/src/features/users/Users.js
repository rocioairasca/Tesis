/**
 * Feature: Gestión de Usuarios
 * Ubicación: src/features/users/Users.js
 * Descripción:
 *  Vista principal para la administración de usuarios del sistema.
 *  Incluye funcionalidad para invitar nuevos usuarios.
 */
import React, { useState } from "react";
import { Button, Modal, Form, Input, Select, message, Space } from "antd";
import { UserAddOutlined, CopyOutlined } from "@ant-design/icons";
import UserTable from "../../components/users/UserTable";
import { inviteUser } from "../../services/authService";

const ROLE_OPTIONS = [
  { value: 0, label: "Empleado" },
  { value: 1, label: "Supervisor" },
  { value: 2, label: "Dueño de Campo" },
];

const Users = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState(null);
  const [form] = Form.useForm();

  const handleInvite = async (values) => {
    try {
      setLoading(true);
      const response = await inviteUser(values);
      setInviteLink(response.inviteLink);
      message.success("Invitación creada exitosamente");
      form.resetFields();
    } catch (error) {
      console.error("Error creating invitation:", error);
      message.error(error?.message || "Error al crear la invitación");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      message.success("Link copiado al portapapeles");
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setInviteLink(null);
    form.resetFields();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1>Gestión de Usuarios</h1>
        <Button
          type="primary"
          icon={<UserAddOutlined />}
          onClick={() => setIsModalOpen(true)}
          style={{ backgroundColor: "#437118", borderColor: "#437118" }}
        >
          Invitar Usuario
        </Button>
      </div>

      <UserTable />

      <Modal
        title="Invitar Nuevo Usuario"
        open={isModalOpen}
        onCancel={handleCloseModal}
        footer={null}
      >
        {!inviteLink ? (
          <Form
            form={form}
            layout="vertical"
            onFinish={handleInvite}
          >
            <Form.Item
              name="email"
              label="Email"
              rules={[
                { required: true, message: "Por favor ingrese el email" },
                { type: "email", message: "Email no válido" }
              ]}
            >
              <Input placeholder="usuario@ejemplo.com" />
            </Form.Item>

            <Form.Item
              name="role"
              label="Rol"
              rules={[{ required: true, message: "Por favor seleccione un rol" }]}
              initialValue={0}
            >
              <Select options={ROLE_OPTIONS} />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                style={{ backgroundColor: "#437118", borderColor: "#437118" }}
              >
                Generar Invitación
              </Button>
            </Form.Item>
          </Form>
        ) : (
          <div>
            <p style={{ marginBottom: 8, fontWeight: 500 }}>Link de invitación generado:</p>
            <Input.TextArea
              value={inviteLink}
              readOnly
              rows={3}
              style={{ marginBottom: 16 }}
            />
            <Space style={{ width: "100%" }}>
              <Button
                type="primary"
                icon={<CopyOutlined />}
                onClick={handleCopyLink}
                style={{ backgroundColor: "#437118", borderColor: "#437118" }}
              >
                Copiar Link
              </Button>
              <Button onClick={handleCloseModal}>
                Cerrar
              </Button>
            </Space>
            <p style={{ marginTop: 16, fontSize: 12, color: "#888" }}>
              Comparte este link con el nuevo usuario. El link expira en 7 días.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Users;
