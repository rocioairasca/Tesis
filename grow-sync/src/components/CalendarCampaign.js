import React, { useState, useEffect } from "react";
import axios from "axios";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction"; // Para futuros clicks, drag&drop
import { Card, message } from "antd";
import "../css/CalendarCampaign.css"; // Estilos personalizados para el calendario

const url = process.env.REACT_APP_URL;

const CalendarCampaign = () => {
  const [events, setEvents] = useState([]);

    const fetchPlantings = async () => {
        try {
        const { data } = await axios.get(`${url}/api/plantings`);
        const formattedEvents = data.map((item) => ({
            id: item.id,
            title: `Siembra de ${item.crop}`,
            start: item.planting_date.split("T")[0], // cortar la hora
            color: "green",
        }));
        setEvents(formattedEvents);
        } catch (error) {
        console.error(error);
        message.error("Error al cargar siembras en el calendario");
        }
    };

    useEffect(() => {
        fetchPlantings();
    }, []);

  return (
    <Card
      style={{
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        borderRadius: "8px",
        marginBottom: 24,
        background: "white",
        padding: "24px", // este padding reemplaza el del div que sacamos
      }}
    >
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        events={events}
        height="auto"
        locale="es"
        headerToolbar={{
          left: "prev",
          center: "title",
          right: "next",
        }}
      />
    </Card>
  );  
};

export default CalendarCampaign;
