import React, { useState, useEffect } from "react";
import { Table, Button, notification, Row, Col, Tag } from "antd";
import axios from "axios";
import { LeftOutlined, CalendarOutlined, DollarOutlined, InboxOutlined, AppstoreOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import useIsMobile from "../hooks/useIsMobile";

const url = process.env.REACT_APP_URL;

const DisabledInventory = () => {
  const [disabledProducts, setDisabledProducts] = useState([]);
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const fetchDisabledProducts = async () => {
    try {
      const res = await axios.get(`${url}/api/products/disabled`);	
      setDisabledProducts(res.data);
    } catch (error) {
      notification.error({ message: 'Error al cargar productos deshabilitados' });
    }
  };

  useEffect(() => {
    fetchDisabledProducts();
  }, []);

  const handleEnable = async (id) => {
    try {
      await axios.put(`${url}/api/products/enable/${id}`);
      notification.success({ message: 'Producto habilitado exitosamente' });
      fetchDisabledProducts();

    } catch (error) {
      notification.error({ message: 'Error al habilitar producto' });
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
        text > 0 ? text : <span style={{ color: "red", fontWeight: "bold" }}>Agotado</span>
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
      title: "Fecha de Vencimiento",
      dataIndex: "acquisition_date",
      key: "acquisition_date",
      render: (text) => text ? new Date(text).toLocaleDateString() : '-'
    },
    {
      title: "Acciones",
      key: "actions",
      render: (_, record) => (
        <Button type="primary" size="small" onClick={() => handleEnable(record.id)}>
          Habilitar
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Productos Deshabilitados</h2>
        </Col>
        <Col>
          <Button 
            icon={<LeftOutlined />} 
            onClick={() => navigate('/inventario')}
            shape="circle"
            type="default"
            style={{ borderColor: "#95ba56" }}
          />
        </Col>
      </Row>

      {!isMobile && (
        <Table
          scroll={{ x: "max-content" }}
          columns={columns}
          dataSource={disabledProducts}
          pagination={{ pageSize: 5, position: ["bottomCenter"] }}
          rowKey="id"
        />
      )}

      {isMobile && (
        <div className="inventory-cards-container">
          {disabledProducts.map((product) => {
            const expiration = new Date(product.acquisition_date);
            const today = new Date();
            const diffDays = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));

            return (
              <div className="inventory-card" key={product._id}>
                <div className="card-header">
                  <h3>{product.name}</h3>
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

                <div style={{ marginTop: 12 }}>
                  <Button type="primary" block onClick={() => handleEnable(product.id)}>
                    Habilitar Producto
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DisabledInventory;
