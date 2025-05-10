import React, { useState, useEffect } from "react";
import { Table, Button, Drawer, Form, Input, InputNumber, Select, Space, Popconfirm, notification, Row, Col, Tag, Dropdown } from "antd";
import { EditOutlined, DeleteOutlined, PlusOutlined, MoreOutlined, CalendarOutlined, DollarOutlined, InboxOutlined, AppstoreOutlined } from "@ant-design/icons";
import axios from "axios";
import useIsMobile from "../hooks/useIsMobile";

const { Option } = Select;
const url = process.env.REACT_APP_URL;

const Inventory = () => {
  // ------------------------- STATE -------------------------
  const [products, setProducts] = useState([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [unit, setUnit] = useState('');
  const [form] = Form.useForm();

  // Detecta si el dispositivo es móvil (para comportamiento responsivo)
  const isMobile = useIsMobile();

  // ------------------------- API -------------------------
  // Función que obtiene la lista de productos desde el backend
  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${url}/api/products`);
      setProducts(res.data); // Actualiza el estado con la lista de productos
    } catch (error) {
      notification.error({ message: 'Error al cargar productos' });
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  // ------------------------- HANDLERS -------------------------
  // Abre el drawer con datos si es edición, vacío si es nuevo
  const openDrawer = (product = null) => {
    if (!product) {
      //  Nuevo producto: limpiamos antes de abrir
      setEditingProduct(null);
      setUnit('');
      form.resetFields();
      form.setFieldsValue({
        type: undefined,
        unit: '',
        acquisition_date: null,
      });

    } else {
      //  Editar producto
      setEditingProduct(product);
      const acquisitionDate = product.acquisition_date
        ? new Date(product.acquisition_date).toISOString().split('T')[0]
        : null;

      const type = ["líquido", "polvo"].includes(product.type) ? product.type : undefined;

      form.setFieldsValue({
        ...product,
        type,
        acquisition_date: acquisitionDate
      });
      setUnit(product.unit);
    }

    // Abrir Drawer al final
    setIsDrawerOpen(true);
  };

  // Cierra el drawer y limpia estados
  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingProduct(null);
    form.resetFields();
  };

  // Envío del formulario para crear o actualizar un producto
  const handleSubmit = async (values) => {
    try {
      const payload = {
        ...values,
        unit: values.unit || (values.type === "líquido" ? "litros" : "kg"),
        available_quantity: editingProduct
          ? editingProduct.available_quantity 
          : values.total_quantity,
      };

      const id = editingProduct?.id || editingProduct?._id;
      
      if (editingProduct && id) {
        // Editar producto existente
        await axios.put(`${url}/api/products/${editingProduct.id}`, payload);
        notification.success({ message: 'Producto actualizado exitosamente' });

      } else {
        // Crear nuevo producto
        await axios.post(`${url}/api/products`, payload);
        notification.success({ message: 'Producto creado exitosamente' });
      }

      fetchProducts(); // Refresca lista
      closeDrawer(); // Cierra el formulario

    } catch (error) {
      
      notification.error({ message: 'Error al guardar producto' });
    }
  };

  // Elimina un producto (lo deshabilita)
  const handleDelete = async (id) => {
    
    try {
      await axios.delete(`${url}/api/products/${id}`);
      notification.success({ message: 'Producto deshabilitado exitosamente' });
      fetchProducts();

    } catch (error) {
      notification.error({ message: 'Error al deshabilitar producto' });
    }
  };

  // ------------------------- TABLE CONFIG -------------------------
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
            onConfirm={() => handleDelete(record.id || record._id)}
            okText="Sí"
            cancelText="No"
          >
            <Button size="small" className="danger-button">Eliminar</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const menuItems = [
    {
      key: '1',
      label: <span onClick={() => window.location.href = "/productos-deshabilitados"}>Ver productos deshabilitados</span>,
    }
  ];

  
  // ------------------------- RENDER -------------------------
  return (
    <div style={{ padding: 12 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12, marginTop: isMobile ? 8 : 24 }}>
        <Col>
          <h2>Gestión de Inventario</h2>
        </Col>
        <Col>
          <Space>
            {isMobile && (
              <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
                <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
              </Dropdown>
            )}
            {!isMobile && (
              <Space>
                <Button onClick={() => window.location.href = "/productos-deshabilitados"}>
                  Ver Productos Deshabilitados
                </Button>
                <Button type="primary" onClick={() => openDrawer(null)}>
                  Agregar Producto
                </Button>
              </Space>
            )}
          </Space>
        </Col>
      </Row>

      {/* Tabla solo en desktop */}
      {!isMobile && (
        <Table
          scroll={{ x: "max-content" }}
          columns={columns}
          dataSource={products}
          pagination={{ pageSize: 5, position: ['bottomCenter'] }}
          rowKey="id"
        />
      )}

      {/* Cards solo en mobile */}
      {isMobile && (
        <div className="inventory-cards-container">
          {products.map((product) => {
            const expiration = new Date(product.acquisition_date);
            const today = new Date();
            const diffDays = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));

            return (
              <div className="inventory-card" key={product._id}>
                <div className="card-header">
                  <h3>{product.name}</h3>
                  <div className="card-icons">
                    <EditOutlined onClick={() => openDrawer(product)} />
                    <DeleteOutlined onClick={() => handleDelete(product._id || product.id)} />
                  </div>
                </div>

                <p><AppstoreOutlined /> <strong>Tipo:</strong> {product.type}</p>
                <p><InboxOutlined /> <strong>Total:</strong> {product.total_quantity} {product.unit}</p>

                <p>
                  <InboxOutlined /> <strong>Disponible:</strong>{" "}
                  <Tag color={
                    product.available_quantity === 0 ? "red" :
                    product.available_quantity < product.total_quantity * 0.3 ? "orange" :
                    "green"
                  }>
                    {product.available_quantity} {product.unit}
                  </Tag>
                </p>

                <p><DollarOutlined /> <strong>Precio:</strong> ${product.price}</p>

                <p>
                  <CalendarOutlined /> <strong>Vence:</strong>{" "}
                  {expiration.toLocaleDateString()}{" "}

                  {diffDays <= 0 && <Tag color="red">Vencido</Tag>}
                  {diffDays > 0 && diffDays <= 15 && <Tag color="orange">Próximo a vencer</Tag>}
                </p>

              </div>
            );
          })}
        </div>
      )}

      <Drawer
        title={editingProduct ? "Editar Producto" : "Agregar Producto"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        height={isMobile ? "90vh" : undefined}
        width={isMobile ? "100%" : 400}
        styles={{ body: { paddingBottom: 80 } }}
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Nombre"
            rules={[{ required: true, message: "Por favor ingresá el nombre del producto." }]}
          >
            <Input placeholder="Por favor ingresá el nombre del producto." />
          </Form.Item>

          <Form.Item
            name="type"
            label="Tipo"
            rules={[{ required: true, message: "Por favor seleccioná el tipo." }]}
          >
            <Select
              allowClear
              placeholder="Seleccioná el tipo de producto"
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
            <InputNumber min={0} style={{ width: "100%" }} placeholder="Ingresá la cantidad total." disabled={!!editingProduct} />
          </Form.Item>

          <Form.Item name="unit" label="Unidad">
            <Input disabled />
          </Form.Item>

          <Form.Item
            name="price"
            label="Precio"
            rules={[{ required: true, message: "Por favor ingresá el precio." }]}
          >
            <InputNumber min={0} style={{ width: "100%" }} prefix="$" placeholder="Ingresá el precio." />
          </Form.Item>

          <Form.Item 
            name="acquisition_date" 
            label="Fecha de Vencimiento"
            rules={[
              {
                required: true,
                message: "Por favor ingresá la fecha de vencimiento.",
              },
              {
                validator: (_, value) => 
                  !value || new Date(value) >= new Date().setHours(0, 0, 0, 0)
                    ? Promise.resolve()
                    : Promise.reject("La fecha de vencimiento no puede ser anterior a la fecha actual.")
              }
            ]}
          >
            <Input type="date" placeholder="dd/mm/aaaa" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingProduct ? "Actualizar Producto" : "Guardar Producto"}
            </Button>
          </Form.Item>
        </Form>
      </Drawer>

      {isMobile && !isDrawerOpen && (
        <div className="fab-button" onClick={() => openDrawer(null)}>
          <PlusOutlined />
        </div>
      )}
    </div>
  );

};

export default Inventory;
