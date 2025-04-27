import React, { useState, useEffect } from "react";
import { Table, Button, notification, Row, Col } from "antd";
import axios from "axios";
import { LeftOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

const url = 'http://localhost:4000';

const DisabledInventory = () => {
  const [disabledProducts, setDisabledProducts] = useState([]);
  const navigate = useNavigate();

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
      title: "Fecha de Adquisición",
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
          <Button icon={<LeftOutlined />} onClick={() => navigate('/inventario')}>
            Volver a Productos
          </Button>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={disabledProducts}
        pagination={{ pageSize: 5, position: ['bottomCenter'] }}
        rowKey="id"
      />
    </div>
  );
};

export default DisabledInventory;
