import React, { useState, useEffect } from "react";
import { Table, Button, Drawer, Form, Input, InputNumber, Space, Popconfirm, notification, Row, Col } from "antd";
import axios from "axios";

const Lotes = () => {
  const [lots, setLots] = useState([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingLot, setEditingLot] = useState(null);
  const [form] = Form.useForm();

  // cargamos los lotes desde el back
  const fetchLots = async () => {
    try {
      const res = await axios.get('http://localhost:4000/api/lots');
      setLots(res.data);
    } catch (error) {
      notification.error({ message: "Error al cargar los lotes" });
    }
  };

  useEffect(() => {
    fetchLots();
  }, []);

  const openDrawer = (lot = null) => {
    setEditingLot(lot);
    setIsDrawerOpen(true);
    if (lot) {
      form.setFieldsValue(lot); // Cargar datos del lote en el formulario
    } else {
      form.resetFields(); // Limpiar el formulario si es un nuevo lote
    }
  }

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingLot(null);
    form.resetFields();
  };

  // Agregar o Editar Lote
  const handleSubmit = async (values) => {
    try {
      if (editingLot) {
        // Editar
        await axios.put(`http://localhost:4000/api/lots/${editingLot.id}`, values);
        notification.success({ message: 'Lote actualizado exitosamente' });
      } else {
        // Agregar nuevo
        await axios.post('http://localhost:4000/api/lots', values);
        notification.success({ message: 'Lote creado exitosamente' });
      }
      fetchLots();
      closeDrawer();
    } catch (error) {
      notification.error({ message: 'Error al guardar lote' });
    }
  };

  // Eliminar (Deshabilitar) Lote
  const handleDelete = async (id) => {
    try {
      await axios.delete(`http://localhost:4000/api/lots/${id}`);
      notification.success({ message: 'Lote deshabilitado exitosamente' });
      fetchLots();
    } catch (error) {
      notification.error({ message: 'Error al deshabilitar lote' });
    }
  };

  const columns = [
    {
      title: "#",
      dataIndex: "index",
      key: "index",
      render: (text, record, index) => index + 1, 
    },
    {
      title: "Nombre del Lote",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "Área Total (ha)",
      dataIndex: "area",
      key: "area",
    },
    {
      title: "Ubicación",
      dataIndex: "location",
      key: "location",
    },
    {
      title: "Acciones",
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openDrawer(record)}>Editar</Button>
          <Popconfirm
            title="¿Estás seguro que querés deshabilitar este lote?"
            onConfirm={() => handleDelete(record.id)}
            okText="Sí"
            cancelText="No"
          >
            <Button size="small" className="danger-button">Eliminar</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* Título y botones */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Gestión de Lotes</h2>
        </Col>
        <Col>
          <Space>
            <Button onClick={() => window.location.href = "/lotes-deshabilitados"}>
              Ver Lotes Deshabilitados
            </Button>
            <Button type="primary" onClick={() => openDrawer()}>
              Agregar Lote
            </Button>
          </Space>
        </Col>
      </Row>

      {/* Tabla */}
      <Table columns={columns} dataSource={lots} pagination={{ pageSize: 5, position: ['bottomCenter'] }} rowKey="id" />

      {/* Drawer para agregar/editar */}
      <Drawer
        title={editingLot ? "Editar Lote" : "Agregar Nuevo Lote"}
        placement="right"
        onClose={closeDrawer}
        open={isDrawerOpen}
        width={400}
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Nombre del Lote"
            rules={[{ required: true, message: "Por favor ingresá el nombre del lote." }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="area"
            label="Área Total (hectáreas)"
            rules={[{ required: true, message: "Por favor ingresá la superficie." }]}
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            name="location"
            label="Ubicación"
            rules={[{ required: true, message: "Por favor ingresá la ubicación." }]}
          >
            <Input />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingLot ? "Actualizar Lote" : "Guardar Lote"}
            </Button>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
};

export default Lotes;

