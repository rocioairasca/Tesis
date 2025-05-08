import React, { useState, useEffect } from "react";
import { Table, Button, Space, Popconfirm, notification, Row, Col } from "antd";
import { LeftOutlined } from "@ant-design/icons";
import axios from "axios";

const url = process.env.REACT_APP_URL;

const DisabledLots = () => {
  const [lots, setLots] = useState([]);

  const fetchDisabledLots = async () => {
    try {
      const res = await axios.get(`${url}/api/lots/disabled`);
      setLots(res.data);
    } catch (error) {
      notification.error({ message: 'Error al cargar lotes deshabilitados' });
    }
  };

  useEffect(() => {
    fetchDisabledLots();
  }, []);

  const handleEnable = async (id) => {
    try {
      await axios.put(`${url}/api/lots/enable/${id}`);
      notification.success({ message: 'Lote habilitado exitosamente' });
      fetchDisabledLots();
    } catch (error) {
      notification.error({ message: 'Error al habilitar lote' });
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
      title: "Acciones",
      key: "actions",
      render: (_, record) => (
        <Space>
          <Popconfirm
            title="¿Querés volver a habilitar este lote?"
            onConfirm={() => handleEnable(record.id)}
            okText="Sí"
            cancelText="No"
          >
            <Button size="small" type="primary">Habilitar</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>

      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Gestión de Lotes Deshabilitados</h2>
        </Col>
        <Col>
            <Button
                type="default"
                icon={<LeftOutlined />}
                onClick={() => window.history.back()}
                style={{ marginBottom: 8 }}
            >
                Volver
            </Button>
        </Col>
      </Row>

      <Table
        scroll={{ x: "max-content" }}
        columns={columns}
        dataSource={lots}
        pagination={{ pageSize: 5, position: ['bottomCenter'] }}
        rowKey="id"
      />
    </div>
  );
};

export default DisabledLots;
