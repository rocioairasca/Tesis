import React, { useState, useEffect } from "react";
import { Table, Button, Drawer, Form, Input, InputNumber, Select, Space, Popconfirm, notification, Row, Col, Tag } from "antd";
import axios from "axios";

const { Option } = Select;
const url = process.env.REACT_APP_URL;

const Inventory = () => {
  const [products, setProducts] = useState([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [unit, setUnit] = useState('');
  const [form] = Form.useForm();

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${url}/api/products`);
      setProducts(res.data);
    } catch (error) {
      notification.error({ message: 'Error al cargar productos' });
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const openDrawer = (product = null) => {
    setEditingProduct(product);
    setIsDrawerOpen(true);
    if (product) {
      const acquisitionDate = product.acquisition_date
        ? new Date(product.acquisition_date).toISOString().split('T')[0]
        : null;
  
      form.setFieldsValue({
        ...product,
        acquisition_date: acquisitionDate
      });
      setUnit(product.unit);
    } else {
      form.resetFields();
      setUnit('');
    }
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingProduct(null);
    form.resetFields();
  };

  const handleSubmit = async (values) => {
    try {
      const payload = {
        ...values,
        available_quantity: values.total_quantity,
      };
      
      if (editingProduct) {
        await axios.put(`${url}/api/products/${editingProduct.id}`, payload);
        notification.success({ message: 'Producto actualizado exitosamente' });
      } else {
        await axios.post(`${url}/api/products`, payload);
        notification.success({ message: 'Producto creado exitosamente' });
      }
      fetchProducts();
      closeDrawer();
    } catch (error) {
      notification.error({ message: 'Error al guardar producto' });
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${url}/api/products/${id}`);
      notification.success({ message: 'Producto deshabilitado exitosamente' });
      fetchProducts();
    } catch (error) {
      notification.error({ message: 'Error al deshabilitar producto' });
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
      title: "Nombre",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "Tipo",
      dataIndex: "type",
      key: "type",
    },
    {
      title: "Cantidad Total",
      dataIndex: "total_quantity",
      key: "total_quantity",
    },
    {
      title: "Cantidad Disponible",
      dataIndex: "available_quantity",
      key: "available_quantity",
      render: (text) => (
        text > 0 ? text : <Tag color="red">Agotado</Tag>
      )
    },
    {
      title: "Unidad",
      dataIndex: "unit",
      key: "unit",
    },
    {
      title: "Precio",
      dataIndex: "price",
      key: "price",
      render: (text) => `$ ${text}`
    },
    {
      title: "Fecha de Adquisición",
      dataIndex: "acquisition_date",
      key: "acquisition_date",
      render: (text) => text ? new Date(text).toLocaleDateString() : '-'
    },
    {
      title: "Acciones",
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openDrawer(record)}>Editar</Button>
          <Popconfirm
            title="¿Estás seguro que querés deshabilitar este producto?"
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
          <h2>Gestión de Inventario</h2>
        </Col>
        <Col>
          <Space>
            <Button onClick={() => window.location.href = "/productos-deshabilitados"}>
              Ver Productos Deshabilitados
            </Button>
            <Button type="primary" onClick={() => openDrawer()}>
              Agregar Producto
            </Button>
          </Space>
        </Col>
      </Row>

      <Table
        scroll={{ x: "max-content" }}
        columns={columns}
        dataSource={products}
        pagination={{ pageSize: 5, position: ['bottomCenter'] }}
        rowKey="id"
      />

      <Drawer
        title={editingProduct ? "Editar Producto" : "Agregar Producto"}
        placement="right"
        onClose={closeDrawer}
        open={isDrawerOpen}
        width={400}
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Nombre"
            rules={[{ required: true, message: "Por favor ingresá el nombre del producto." }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="type"
            label="Tipo"
            rules={[{ required: true, message: "Por favor seleccioná el tipo." }]}
          >
            <Select placeholder="Seleccione tipo"
              onChange={(value) => {
                form.setFieldsValue({ unit: value === "líquido" ? "litros" : "kg" });
                setUnit(value === "líquido" ? "litros" : "kg");
              }}
            >
              <Option value="líquido">Líquido</Option>
              <Option value="polvo">Polvo</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="total_quantity"
            label="Cantidad Total"
            rules={[{ required: true, message: "Por favor ingresá la cantidad total." }]}
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            name="unit"
            label="Unidad"
          >
            <Input disabled />
          </Form.Item>

          <Form.Item
            name="price"
            label="Precio"
            rules={[{ required: true, message: "Por favor ingresá el precio." }]}
          >
            <InputNumber min={0} style={{ width: "100%" }} prefix="$" />
          </Form.Item>

          <Form.Item
            name="acquisition_date"
            label="Fecha de Adquisición"
          >
            <Input type="date" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingProduct ? "Actualizar Producto" : "Guardar Producto"}
            </Button>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
};

export default Inventory;
