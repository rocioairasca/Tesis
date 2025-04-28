import React, { useState, useEffect } from "react";
import { Table, Button, Space, Row, Col, notification } from "antd";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";

const DisabledUsages = () => {
  const [usages, setUsages] = useState([]);
  const [products, setProducts] = useState([]);
  const navigate = useNavigate();

  const fetchDisabledUsages = async () => {
    try {
      const res = await axios.get('http://localhost:4000/api/usages/disabled');
      setUsages(res.data);
    } catch (error) {
      notification.error({ message: 'Error al cargar registros deshabilitados' });
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

  useEffect(() => {
    fetchDisabledUsages();
    fetchProducts();
  }, []);

  const handleEnable = async (id) => {
    try {
      await axios.put(`http://localhost:4000/api/usages/enable/${id}`);
      notification.success({ message: 'Registro de uso habilitado exitosamente' });
      fetchDisabledUsages();
    } catch (error) {
      notification.error({ message: 'Error al habilitar registro de uso' });
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
      title: "Producto",
      dataIndex: "product_id",
      key: "product_id",
      render: (text) => {
        const product = products.find(p => p.id === text);
        return product ? product.name : "-";
      }
    },
    {
      title: "Cantidad Usada",
      dataIndex: "amount_used",
      key: "amount_used",
    },
    {
      title: "Lotes",
      dataIndex: "lot_ids",
      key: "lot_ids",
    },
    {
      title: "Área Total (ha)",
      dataIndex: "total_area",
      key: "total_area",
    },
    {
      title: "Fecha de Uso",
      dataIndex: "date",
      key: "date",
      render: (text) => dayjs(text).format('DD/MM/YYYY')
    },
    {
      title: "Acciones",
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button type="primary" size="small" onClick={() => handleEnable(record.id)}>
            Habilitar
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Registros de Uso Deshabilitados</h2>
        </Col>
        <Col>
          <Button onClick={() => navigate('/usage')}>
            ← Volver a Registros de Uso
          </Button>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={usages}
        pagination={{ pageSize: 5, position: ['bottomCenter'] }}
        rowKey="id"
      />
    </div>
  );
};

export default DisabledUsages;
