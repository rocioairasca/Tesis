import React, { useState, useEffect } from "react";
import { Table, Tag, Card, Divider } from "antd";
import axios from "axios";
import useIsMobile from "../hooks/useIsMobile";

const url = process.env.REACT_APP_URL;

const Vehicles = () => {

  // ------------------------- STATE -------------------------
  const [vehicles, setVehicles] = useState([]);

  const isMobile = useIsMobile();

  // ------------------------- API -------------------------
  // Función que obtiene la lista de vehiculos desde el backend
  const fetchVehicles = async () => {
    try {
      const res = await axios.get(`${url}/api/vehicles`);
      setVehicles(res.data); // Actualiza el estado con la lista de vehiculos
    } catch (error) {
      console.log( "Error al obtener la lista de vehiculos fetchVehicles(l.17)")
    }
  };

  useEffect(() => {
    fetchVehicles();
  }, []);

  const columns = [
    {
      title: "Marca",
      dataIndex: "marca",
      key: "marca",
    },
    {
      title: "Modelo",
      dataIndex: "modelo",
      key: "modelo",
    },
    {
      title: "Tipo",
      dataIndex: "tipo",
      key: "tipo",
    },
    {
      title: "Año",
      dataIndex: "anio",
      key: "anio",
      responsive: ["md"], // Solo se muestra en dispositivos medianos o mayores
    },
    {
      title: "Patente",
      dataIndex: "patente",
      key: "patente",
    }
  ];

  return (
    <div>
        <h2>Gestión de Vehiculos</h2>
        <Table
            dataSource={vehicles}
            columns={columns}
            rowKey="patente"
            size={isMobile ? "small" : "middle"}
            scroll={isMobile ? { x: true } : undefined}
            pagination={isMobile ? { pageSize: 5 } : { pageSize: 10 }}
        />
    </div>
    
  );
};

export default Vehicles;