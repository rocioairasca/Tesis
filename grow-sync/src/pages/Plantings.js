import React, { useState, useEffect } from "react";
import { Table, Button, Drawer, Form, Input, DatePicker, Space, message, Popconfirm, Row, Col } from "antd";
import axios from "axios";
import dayjs from "dayjs";
import CalendarCampaign from "../components/CalendarCampaign";

// const { Option } = Select;

const Plantings = () => {
  const [plantings, setPlantings] = useState([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [editingPlanting, setEditingPlanting] = useState(null);
  const [loading, setLoading] = useState(false);

  // Traer siembras
  const fetchPlantings = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get("http://localhost:4000/api/plantings");
      setPlantings(data);
    } catch (error) {
      console.error(error);
      message.error("Error al cargar siembras");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlantings();
  }, []);

  const handleAdd = () => {
    form.resetFields();
    setEditingPlanting(null);
    setOpen(true);
  };

  const handleEdit = (record) => {
    setEditingPlanting(record);
    form.setFieldsValue({
      ...record,
      planting_date: dayjs(record.planting_date),
      crop: record.crop,
      seed_variety: record.seed_variety,
      density: record.density,
      total_seeds: record.total_seeds,
      notes: record.notes
    });
    setOpen(true);
  };

  const handleFinish = async (values) => {
    const payload = {
      lot_id: 1, // POR AHORA: simular lote fijo (después lo traemos bien)
      planting_date: values.planting_date.format("YYYY-MM-DD"),
      crop: values.crop,
      seed_variety: values.seed_variety,
      density: values.density,
      total_seeds: values.total_seeds,
      notes: values.notes
    };

    try {
      if (editingPlanting) {
        await axios.put(`http://localhost:4000/api/plantings/${editingPlanting.id}`, payload);
        message.success("Siembra actualizada exitosamente");
      } else {
        await axios.post("http://localhost:4000/api/plantings", payload);
        message.success("Siembra creada exitosamente");
      }
      setOpen(false);
      fetchPlantings(); // Refrescar tabla
    } catch (error) {
      console.error(error);
      message.error("Error al guardar siembra");
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`http://localhost:4000/api/plantings/${id}`);
      message.success("Siembra deshabilitada exitosamente");
      fetchPlantings();
    } catch (error) {
      console.error(error);
      message.error("Error al deshabilitar siembra");
    }
  };

  const columns = [
    {
      title: "Fecha de Siembra",
      dataIndex: "planting_date",
      key: "planting_date",
      render: (text) => dayjs(text).format('DD/MM/YYYY')
    },
    {
      title: "Cultivo",
      dataIndex: "crop",
      key: "crop",
    },
    {
      title: "Variedad",
      dataIndex: "seed_variety",
      key: "seed_variety",
    },
    {
      title: "Densidad (semillas/ha)",
      dataIndex: "density",
      key: "density",
    },
    {
      title: "Total Semillas",
      dataIndex: "total_seeds",
      key: "total_seeds",
    },
    {
      title: "Notas",
      dataIndex: "notes",
      key: "notes",
    },
    {
      title: "Acciones",
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => handleEdit(record)}>
            Editar
          </Button>
          <Popconfirm
            title="¿Estás seguro de deshabilitar esta siembra?"
            onConfirm={() => handleDelete(record.id)}
            okText="Sí"
            cancelText="No"
          >
            <Button size="small" className="danger-button">
              Eliminar
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: "24px" }}>
        {/* Título y botones */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Gestión de Siembra</h2>
        </Col>
        <Col>
          <Space>
            <Button onClick={() => window.location.href = "/lotes-deshabilitados"}>
              Ver Siembras Deshabilitadas
            </Button>
            <Button type="primary" onClick={handleAdd}>
              Agregar Siembra
            </Button>
          </Space>
        </Col>
      </Row>

      <Row gutter={24}>
        <Col span={12}>
          <CalendarCampaign />  
        </Col>
        <Col span={12}>
            <Table
                columns={columns}
                dataSource={plantings}
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 5, position: ['bottomCenter']}}
                locale={{ emptyText: "No hay siembras registradas aún." }}
            />
        </Col>
      </Row>

      <Drawer
        title={editingPlanting ? "Editar Siembra" : "Agregar Siembra"}
        width={400}
        onClose={() => setOpen(false)}
        open={open}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleFinish}
        >
          <Form.Item
            name="planting_date"
            label="Fecha de Siembra"
            rules={[{ required: true, message: "Por favor ingresa la fecha" }]}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            name="crop"
            label="Cultivo"
            rules={[{ required: true, message: "Por favor ingresa el cultivo" }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="seed_variety"
            label="Variedad de Semilla"
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="density"
            label="Densidad (semillas/ha)"
          >
            <Input type="number" />
          </Form.Item>

          <Form.Item
            name="total_seeds"
            label="Total Semillas"
          >
            <Input type="number" />
          </Form.Item>

          <Form.Item
            name="notes"
            label="Notas"
          >
            <Input.TextArea />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingPlanting ? "Actualizar" : "Agregar"}
            </Button>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
};

export default Plantings;