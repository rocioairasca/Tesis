import React, { useState, useEffect } from "react";
import { Table, Button, Row, Col, notification } from "antd";
import { ArrowLeftOutlined, CalendarOutlined } from "@ant-design/icons";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import useIsMobile from "../hooks/useIsMobile";
import { Package, MapPin, Ruler } from "phosphor-react";

const url = process.env.REACT_APP_URL;

const DisabledUsages = () => {
  const [usages, setUsages] = useState([]);
  const [products, setProducts] = useState([]);
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const fetchDisabledUsages = async () => {
    try {
      const res = await axios.get(`${url}/api/usages/disabled`);
      setUsages(res.data);
    } catch (error) {
      notification.error({ message: 'Error al cargar registros deshabilitados' });
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

  useEffect(() => {
    fetchDisabledUsages();
    fetchProducts();
  }, []);

  const handleEnable = async (id) => {
    try {
      await axios.put(`${url}/api/usages/enable/${id}`);
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
          <h2>Registros de Uso Deshabilitados</h2>
        </Col>
        <Col>
        {!isMobile && (
          <Button onClick={() => navigate('/usage')}>
            ← Volver a Registros de Uso
          </Button>
        )}

        {isMobile && (
          <Button 
            icon={<ArrowLeftOutlined />} 
            onClick={() => navigate('/usage')}
            shape="circle"
            type="default"
            style={{ borderColor: "#95ba56" }}
          />
        )}
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
            const lotList = JSON.parse(usage.lot_ids || "[]").join(", ");
            const date = dayjs(usage.date).format("DD/MM/YYYY");

            return (
              <div className="inventory-card" key={usage.id}>
                <div className="card-header">
                  <h3>{product?.name || "-"}</h3>
                </div>

                <p className="flex-row"><Package size={18} style={{ marginRight: 8 }} /> <strong>Cantidad:</strong> {usage.amount_used} {usage.unit}</p>
                <p className="flex-row"><MapPin size={18} style={{ marginRight: 8 }} /> <strong>Lotes:</strong> {lotList}</p>
                <p className="flex-row"><Ruler size={18} style={{ marginRight: 8 }} /> <strong>Área Total:</strong> {usage.total_area} ha</p>
                <p><CalendarOutlined style={{ marginRight: 8 }} /> <strong>Fecha:</strong> {date}</p>

                <div style={{ marginTop: 12 }}>
                  <Button type="primary" block onClick={() => handleEnable(usage.id)}>
                    Habilitar Registro
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

export default DisabledUsages;
