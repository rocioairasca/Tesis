import React, { useState, useEffect } from "react";
import { Table, Button, Drawer, Form, Input, InputNumber, Select, DatePicker, Space, Popconfirm, Row, Col, notification } from "antd";
import axios from "axios";
import { PlusOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";

const { Option } = Select;

const Usage = () => {
  const [usages, setUsages] = useState([]);
  const [products, setProducts] = useState([]);
  const [lots, setLots] = useState([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingUsage, setEditingUsage] = useState(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const fetchUsages = async () => {
    try {
      const res = await axios.get('http://localhost:4000/api/usages');
      setUsages(res.data);
    } catch (error) {
      notification.error({ message: 'Error al cargar registros de uso' });
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await axios.get('http://localhost:4000/api/products');
      setProducts(res.data);
    } catch (error) {
      notification.error({ message: 'Error al cargar productos' });
    }
  };

  const fetchLots = async () => {
    try {
      const res = await axios.get('http://localhost:4000/api/lots');
      setLots(res.data);
    } catch (error) {
      notification.error({ message: 'Error al cargar lotes' });
    }
  };

  useEffect(() => {
    fetchUsages();
    fetchProducts();
    fetchLots();
  }, []);

  const openDrawer = (usage = null) => {
    setEditingUsage(usage);
    setIsDrawerOpen(true);
    if (usage) {
      form.setFieldsValue({
        ...usage,
        lot_ids: JSON.parse(usage.lot_ids),
        date: dayjs(usage.date),
      });
    } else {
      form.resetFields();
    }
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingUsage(null);
    form.resetFields();
  };

  const storedUser = JSON.parse(localStorage.getItem('user'));
  const userName = storedUser?.name;

  const handleSubmit = async (values) => {
    try {
      const payload = {
        ...values,
        lot_ids: JSON.stringify(values.lot_ids),
        date: values.date.format('YYYY-MM-DD'),
        user_id: userName,
      };

      if (editingUsage) {
        await axios.put(`http://localhost:4000/api/usages/${editingUsage.id}`, payload);
        notification.success({ message: 'Registro de uso actualizado exitosamente' });
      } else {
        await axios.post('http://localhost:4000/api/usages', payload);
        notification.success({ message: 'Registro de uso creado exitosamente' });
      }

      fetchUsages();
      closeDrawer();
    } catch (error) {
      notification.error({ message: 'Error al guardar registro de uso' });
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`http://localhost:4000/api/usages/${id}`);
      notification.success({ message: 'Registro de uso deshabilitado exitosamente' });
      fetchUsages();
    } catch (error) {
      notification.error({ message: 'Error al deshabilitar registro de uso' });
    }
  };

  const handleProductChange = (productId) => {
    const selectedProduct = products.find(p => p.id === productId);
    if (selectedProduct) {
      form.setFieldsValue({
        unit: selectedProduct.unit
      });
    }
  };  

  const handleLotChange = (selectedLotIds) => {
    let totalArea = 0;
    selectedLotIds.forEach(id => {
      const lot = lots.find(l => l.id === id);
      if (lot) {
        totalArea += parseFloat(lot.area || 0);
      }
    });
  
    form.setFieldsValue({
      total_area: totalArea
    });
  };  

  const columns = [
    {
      title: "#",
      dataIndex: "index",
      key: "index",
      render: (text, record, index) => index + 1,
    },
    {
      title: "Producto",
      dataIndex: "product_id",
      key: "product_id",
      render: (text) => {
        const product = products.find(p => p.id === text);
        return product ? product.name : "-";
      }
    },
    {
      title: "Cantidad",
      dataIndex: "amount_used",
      key: "amount_used",
      render: (text, record) => `${text} ${record.unit}`
    },
    {
      title: "Lotes",
      dataIndex: "lot_ids",
      key: "lot_ids",
      render: (text) => {
        const lotIds = JSON.parse(text);
        return lotIds.join(", ");
      }
    },
    {
      title: "Área Total",
      dataIndex: "total_area",
      key: "total_area",
      render: (text) => `${text} ha`
    },
    {
      title: "Cultivo Previo",
      dataIndex: "previous_crop",
      key: "previous_crop",
    },
    {
      title: "Cultivo Actual",
      dataIndex: "current_crop",
      key: "current_crop",
    },
    {
      title: "Usuario",
      dataIndex: "user_id",
      key: "user_id",
    },
    {
      title: "Fecha",
      dataIndex: "date",
      key: "date",
      render: (text) => dayjs(text).format('DD/MM/YYYY')
    },
    {
      title: "Acciones",
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openDrawer(record)}>Editar</Button>
          <Popconfirm
            title="¿Estás seguro que querés deshabilitar este registro?"
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
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Gestión de Registros de Uso</h2>
        </Col>
        <Col>
          <Space>
            <Button onClick={() => navigate('/usages-disabled')}>
              Ver Registros Deshabilitados
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
              Agregar Registro
            </Button>
          </Space>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={usages}
        pagination={{ pageSize: 5, position: ['bottomCenter'] }}
        rowKey="id"
      />

      <Drawer
        title={editingUsage ? "Editar Registro de Uso" : "Agregar Registro de Uso"}
        placement="right"
        onClose={closeDrawer}
        open={isDrawerOpen}
        width={400}
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
            <Form.Item
                name="product_id"
                label="Producto"
                rules={[{ required: true, message: "Seleccioná un producto" }]}
                >
                <Select
                    placeholder="Seleccione un producto"
                    onChange={handleProductChange}
                >
                    {products.map((product) => (
                    <Option key={product.id} value={product.id}>{product.name}</Option>
                    ))}
                </Select>
            </Form.Item>

          <Form.Item
            name="amount_used"
            label="Cantidad Usada"
            rules={[{ required: true, message: "Ingresá la cantidad usada" }]}
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            name="unit"
            label="Unidad"
            rules={[{ required: true, message: "Ingresá la unidad" }]}
          >
            <Input disabled placeholder="Se asigna según el producto seleccionado" />
          </Form.Item>

          <Form.Item
            name="lot_ids"
            label="Seleccionar Lotes"
            rules={[{ required: true, message: "Seleccioná al menos un lote" }]}
          >
            <Select mode="multiple" placeholder="Seleccione lotes" onChange={handleLotChange}>
              {lots.map((lot) => (
                <Option key={lot.id} value={lot.id}>{lot.name}</Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="total_area"
            label="Área Total (ha)"
            rules={[{ required: true, message: "Ingresá el área total" }]}
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item name="previous_crop" label="Cultivo Previo">
            <Input />
          </Form.Item>

          <Form.Item name="current_crop" label="Cultivo Actual">
            <Input />
          </Form.Item>

          <Form.Item
            name="date"
            label="Fecha de Uso"
            rules={[{ required: true, message: "Seleccioná la fecha" }]}
          >
            <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingUsage ? "Actualizar Registro" : "Registrar Uso"}
            </Button>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
};

export default Usage;
