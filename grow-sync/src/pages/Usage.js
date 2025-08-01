import React, { useState, useEffect } from "react";
import { Table, Button, Drawer, Form, Input, InputNumber, Select, DatePicker, Dropdown, Space, Popconfirm, Row, Col, notification } from "antd";
import axios from "axios";
import {
  PlusOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import {
  Package,
  MapPin,
  Ruler,
  Leaf,
  User,
  Calendar,
} from "phosphor-react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import useIsMobile from "../hooks/useIsMobile";

const url = process.env.REACT_APP_URL;
const { Option } = Select;

const Usage = () => {
  const [usages, setUsages] = useState([]);
  const [products, setProducts] = useState([]);
  const [lots, setLots] = useState([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingUsage, setEditingUsage] = useState(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [selectedProduct, setSelectedProduct] = useState(null);

  const fetchUsages = async () => {
    try {
      const res = await axios.get(`${url}/api/usages`);
      setUsages(res.data);
    } catch (error) {
      notification.error({ message: 'Error al cargar registros de uso' });
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${url}/api/products`);
      setProducts(res.data);
    } catch (error) {
      notification.error({ message: 'Error al cargar productos' });
    }
  };

  const fetchLots = async () => {
    try {
      const res = await axios.get(`${url}/api/lots`);
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
      const selectedProduct = products.find(p => p.id === usage.product_id);
      if (selectedProduct) {
        setSelectedProduct(selectedProduct);
      }

      form.setFieldsValue({
        ...usage,
        lot_ids: usage.usage_lots ? usage.usage_lots.map(l => l.lot_id) : [],
        date: dayjs(usage.date),
      });

    } else {
      setSelectedProduct(null);
      form.resetFields();
    }
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingUsage(null);
    form.resetFields();
  };

  const storedUser = JSON.parse(localStorage.getItem('user'));
  const userName = storedUser?.id;

  const handleSubmit = async (values) => {
    try {
      const payload = {
        ...values,
        lot_ids: values.lot_ids,
        date: values.date.format('YYYY-MM-DD'),
        user_id: userName,
      };

      if (editingUsage) {
        await axios.put(`${url}/api/usages/${editingUsage.id}`, payload);
        notification.success({ message: 'Registro de uso actualizado exitosamente' });
      } else {
        await axios.post(`${url}/api/usages`, payload);
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
      await axios.delete(`${url}/api/usages/${id}`);
      notification.success({ message: 'Registro de uso deshabilitado exitosamente' });
      fetchUsages();
    } catch (error) {
      notification.error({ message: 'Error al deshabilitar registro de uso' });
    }
  };

  const handleProductChange = (productId) => {
    const selectedProduct = products.find(p => p.id === productId);
    if (selectedProduct) {
      setSelectedProduct(selectedProduct);
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

    const roundedArea = Math.round(totalArea * 100) / 100;
  
    form.setFieldsValue({
      total_area: roundedArea
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
      render: (_, record) => {
        if (!record.usage_lots) return '-';
        const lotNames = record.usage_lots.map(l => {
          const lot = lots.find(lotItem => lotItem.id === l.lot_id);
          return lot ? lot.name : l.lot_id;
        });
        return lotNames.join(", ");
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
      key: "user",
      render: (_, record) => {
        return record.users?.full_name || record.users?.nickname || record.users?.email || "-";
      }
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

  const menuItems = [
    {
      key: '1',
      label: <span onClick={() => window.location.href = "/usages-disabled"}>Ver Registros Deshabilitados</span>,
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Gestión de Registros de Uso</h2>
        </Col>
        <Col>
          <Space>
            {isMobile ? (
              <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
                <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
              </Dropdown>
            ) : (
              <Space>
                <Button onClick={() => navigate("/usages-disabled")}>
                  Ver Registros Deshabilitados
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
                  Agregar Registro
                </Button>
              </Space>
            )}
          </Space>
        </Col>
      </Row>

      {!isMobile && (
        <Table
          scroll={{ x: "max-content" }}
          columns={columns}
          dataSource={usages}
          pagination={{ pageSize: 5, position: ['bottomCenter'] }}
          rowKey="id"
        />
      )}

      {isMobile && (
        <div className="inventory-cards-container">
          {usages.map((usage) => {
            const product = products.find(p => p.id === usage.product_id);
            const lotList = usage.usage_lots
              ? usage.usage_lots.map(l => {
                  const lot = lots.find(lotItem => lotItem.id === l.lot_id);
                  return lot ? lot.name : l.lot_id;
                }).join(", ")
              : "-";
            const date = dayjs(usage.date).format("DD/MM/YYYY");

            return (
              <div className="inventory-card" key={usage.id}>
                <div className="card-header">
                  <h3>{product?.name || "Producto"}</h3>
                  <div className="card-icons">
                    <EditOutlined onClick={() => openDrawer(usage)} />
                    <DeleteOutlined onClick={() => handleDelete(usage.id)} />
                  </div>
                </div>

                <p className="flex-row"><Package size={18} /> <strong>Cantidad:</strong> {usage.amount_used} {usage.unit}</p>
                <p className="flex-row"><MapPin size={18} /> <strong>Lotes:</strong> {lotList}</p>
                <p className="flex-row"><Ruler size={18} /> <strong>Área Total:</strong> {usage.total_area} ha</p>
                <p className="flex-row"><Leaf size={18} /> <strong>Cultivo Previo:</strong> {usage.previous_crop || "-"}</p>
                <p className="flex-row"><Leaf size={18} /> <strong>Cultivo Actual:</strong> {usage.current_crop || "-"}</p>
                <p className="flex-row"><User size={18} /> <strong>Usuario:</strong> {usage.users?.full_name || usage.users?.nickname || usage.users?.email}</p>
                <p className="flex-row"><Calendar size={18} /> <strong>Fecha:</strong> {date}</p>
              </div>
            );
          })}
        </div>
      )}


      <Drawer
        title={editingUsage ? "Editar Registro de Uso" : "Agregar Registro de Uso"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        height={isMobile ? "90vh" : undefined}
        width={isMobile ? "100%" : 400}
        styles={{ body: { paddingBottom: 80 } }}
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

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontWeight: 500 }}>Cantidad Usada</label>
            {selectedProduct && (
              <div style={{ fontSize: 13, color: "#888" }}>
                Disponible: <strong>{selectedProduct.available_quantity} {selectedProduct.unit}</strong>
              </div>
            )}
          </div>

          <Form.Item
            name="amount_used"
            rules={[
              { required: true, message: "Ingresá la cantidad usada" },
              {
                validator: (_, value) => {
                  if (selectedProduct && value > selectedProduct.available_quantity) {
                    return Promise.reject(`Solo hay ${selectedProduct.available_quantity} disponibles`);
                  }
                  return Promise.resolve();
                }
              }
            ]}
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
            <InputNumber disabled min={0} style={{ width: "100%" }} />
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

      {isMobile && !isDrawerOpen && (
        <div className="fab-button" onClick={() => openDrawer()}>
          <PlusOutlined />
        </div>
      )}

    </div>
  );
};

export default Usage;
