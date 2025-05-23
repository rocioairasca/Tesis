import React, { useState, useEffect } from "react";
import { Table, Button, Space, Popconfirm, notification, Row, Col } from "antd";
import { LeftOutlined } from "@ant-design/icons";
import axios from "axios";
import useIsMobile from "../hooks/useIsMobile";

const url = process.env.REACT_APP_URL;

const DisabledLots = () => {
  const [lots, setLots] = useState([]);
  const isMobile = useIsMobile();

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
              shape="circle"
              onClick={() => window.history.back()}
              style={{ borderColor: "#95ba56" }}
            />
        </Col>
      </Row>

      {!isMobile && (
        <Table
          scroll={{ x: "max-content" }}
          columns={columns}
          dataSource={lots}
          pagination={{ pageSize: 5, position: ['bottomCenter'] }}
          rowKey="id"
        />
      )}

      {isMobile && (
        <div className="inventory-cards-container">
          {lots.map((lot) => (
            <div key={lot.id} className="inventory-card">
              <h3>{lot.name}</h3>
              <p>Área Total: {lot.area} ha</p>
              <Button type="primary" onClick={() => handleEnable(lot.id)}>Habilitar</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DisabledLots;
