import React, { useState, useEffect, useRef } from "react";
import { Dropdown, Table, Button, Drawer, Form, Input, InputNumber, Space, Popconfirm, notification, Row, Col } from "antd";
import { MoreOutlined, EnvironmentOutlined, AimOutlined, EditOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import axios from "axios";
import useIsMobile from "../hooks/useIsMobile";
import MapSelector from '../components/MapSelector';

const url = process.env.REACT_APP_URL;

const Lotes = () => {
  const [lots, setLots] = useState([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingLot, setEditingLot] = useState(null);
  const [form] = Form.useForm();

  const [isMapModalOpen, setIsMapModalOpen] = useState(false); 
  const [selectedLocation, setSelectedLocation] = useState(null);
  const mapRef = useRef();
  const isMobile = useIsMobile();

  // cargamos los lotes desde el back
  const fetchLots = async () => {
    try {
      const res = await axios.get(`${url}/api/lots`);
      setLots(res.data);
    } catch (error) {
      notification.error({ message: "Error al cargar los lotes" });
    }
  };

  useEffect(() => {
    fetchLots();
  }, []);

  const openDrawer = (lot = null) => {
    setEditingLot(lot);
    setIsDrawerOpen(true);
    if (lot) {
      form.setFieldsValue(lot); // Cargar datos del lote en el formulario
    } else {
      form.resetFields(); // Limpiar el formulario si es un nuevo lote
    }
  }

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setEditingLot(null);
    form.resetFields();
  };

  // Agregar o Editar Lote
  const handleSubmit = async (values) => {
    try {
      if (editingLot) {
        // Editar
        await axios.put(`${url}/api/lots/${editingLot.id}`, values);
        notification.success({ message: 'Lote actualizado exitosamente' });
      } else {
        // Agregar nuevo
        await axios.post(`${url}/api/lots`, values);
        notification.success({ message: 'Lote creado exitosamente' });
      }
      fetchLots();
      closeDrawer();
    } catch (error) {
      notification.error({ message: 'Error al guardar lote' });
    }
  };

  // Eliminar (Deshabilitar) Lote
  const handleDelete = async (id) => {
    try {
      await axios.delete(`${url}/api/lots/${id}`);
      notification.success({ message: 'Lote deshabilitado exitosamente' });
      fetchLots();
    } catch (error) {
      notification.error({ message: 'Error al deshabilitar lote' });
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
      title: "Ubicación",
      dataIndex: "location",
      key: "location",
      render: (location) => {
        if (!location) return "Sin ubicación";
    
        return (
          <Button type="link" onClick={() => setSelectedLocation(JSON.parse(location))}>
            Ver
          </Button>
        );
      }
    },
    {
      title: "Acciones",
      key: "actions",
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openDrawer(record)}>Editar</Button>
          <Popconfirm
            title="¿Estás seguro que querés deshabilitar este lote?"
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
      label: <span onClick={() => window.location.href = "/lotes-deshabilitados"}>Ver Lotes Deshabilitados</span>,
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* Título y botones */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <h2>Gestión de Lotes</h2>
        </Col>
        <Col>
          <Space>
            {isMobile ? (
              <Dropdown menu={{ items: menuItems }} placement="bottomRight" arrow>
                <MoreOutlined style={{ fontSize: 24, cursor: "pointer" }} />
              </Dropdown>
            ) : (
              <Space>
                <Button onClick={() => window.location.href = "/lotes-deshabilitados"}>
                  Ver Lotes Deshabilitados
                </Button>
                <Button type="primary" onClick={() => openDrawer()}>
                  Agregar Lote
                </Button>
              </Space>
            )}
          </Space>
        </Col>
      </Row>

      {!isMobile&& (
        <Row gutter={24}>
          <Col span={12}>
            {/* Mapa a la izquierda */}
            <MapSelector lots={lots} selectedLocation={selectedLocation} modalOpen={false} />
          </Col>
          <Col span={12}>
            {/* Tabla de lotes a la derecha */}
            <Table
              scroll={{ x: "max-content" }}
              columns={columns}
              dataSource={lots}
              pagination={{ pageSize: 5, position: ['bottomCenter'] }}
              rowKey="id"
            />
          </Col>
        </Row>
      )}

      {isMobile && (
        <div style={{ marginBottom: 24 }}>
          <MapSelector lots={lots} selectedLocation={selectedLocation} modalOpen={false} />
        </div>
      )}

      {isMobile && (
        <div className="inventory-cards-container">
          {lots.map((lot) => (
            <div className="inventory-card" key={lot.id}>
              <div className="card-header">
                <h3>{lot.name}</h3>
                <div className="card-icons">
                  <EditOutlined onClick={() => openDrawer(lot)} />
                  <DeleteOutlined onClick={() => handleDelete(lot.id)} />
                </div>
              </div>
              <p><AimOutlined style={{ marginRight: 8 }} /> <strong>Área:</strong> {lot.area} ha</p>
              <p>
                <EnvironmentOutlined style={{ marginRight: 8 }} /> <strong>Ubicación:</strong>{" "}
                {lot.location ? (
                  <>
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, marginLeft: 0 }}
                      onClick={() => setSelectedLocation(JSON.parse(lot.location))}
                    >
                      Ver
                    </Button>
                  </>
                ) : (
                  "No asignada"
                )}
              </p>

            </div>
          ))}
        </div>
      )}

      {/* Drawer para agregar/editar */}
      <Drawer
        title={editingLot ? "Editar Lote" : "Agregar Nuevo Lote"}
        placement={isMobile ? "bottom" : "right"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        width={400}
      >
        <Form layout="vertical" form={form} onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Nombre del Lote"
            rules={[{ required: true, message: "Por favor ingresá el nombre del lote." }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="area"
            label="Área Total (hectáreas)"
            rules={[{ required: true, message: "Por favor ingresá la superficie." }]}
            extra="Área calculada automáticamente. Podés modificarla si lo deseás."
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item name="location" hidden>
            <Input />
          </Form.Item>

          <Form.Item>
            <Button type="default" onClick={() => setIsMapModalOpen(true)} block>
              Seleccionar ubicación en el mapa
            </Button>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingLot ? "Actualizar Lote" : "Guardar Lote"}
            </Button>
          </Form.Item>
        </Form>

        <Drawer
          title="Seleccioná la ubicación del Lote"
          placement="right"
          open={isMapModalOpen}
          onClose={() => setIsMapModalOpen(false)}
          width={800}
          afterOpenChange={(open) => {
            if (open && mapRef.current) {
              mapRef.current.invalidateSize();
            }
          }}
        >
          <MapSelector
            lots={lots}
            initialLocation={editingLot?.location ? JSON.parse(editingLot.location) : null}
            onSelect={(data) => {
              form.setFieldsValue({
                location: data.location,
                area: data.calculatedArea
              });
              setIsMapModalOpen(false);
            }}
            modalOpen={isMapModalOpen}
            mapRef={mapRef}
            insideDrawer={true}
          />
        </Drawer>

      </Drawer>

      {isMobile && !isDrawerOpen && (
        <div className="fab-button" onClick={() => openDrawer()}>
          <PlusOutlined />
        </div>
      )}
    </div>
  );
};

export default Lotes;

