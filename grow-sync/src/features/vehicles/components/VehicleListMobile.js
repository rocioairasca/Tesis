/**
 * Componente: VehicleListMobile
 * Ubicación: src/features/vehicles/components/VehicleListMobile.js
 * Descripción:
 *  Componente presentacional para la lista de vehículos en versión móvil.
 *  Utiliza tarjetas (cards) para mostrar la información de manera responsive.
 */
import React from 'react';
import { EditOutlined, DeleteOutlined, CarOutlined } from "@ant-design/icons";
import { Truck, IdentificationCard, ClipboardText, Gauge } from "phosphor-react";

const VehicleListMobile = ({
    vehicles,
    onEdit,
    onDisable,
    rowKey,
    getId,
    statusTag,
    numberFmt
}) => {
    return (
        <div className="inventory-cards-container">
            {vehicles.map((v) => (
                <div className="inventory-card" key={rowKey(v)}>
                    <div className="card-header">
                        <h3>{v.name}</h3>
                        <div className="card-icons">
                            <EditOutlined onClick={() => onEdit(v)} />
                            <DeleteOutlined onClick={() => onDisable(getId(v))} />
                        </div>
                    </div>

                    <p className="flex-row"><Truck size={18} /> <strong>Tipo:</strong> {v.type || "-"}</p>
                    <p className="flex-row"><ClipboardText size={18} /> <strong>Marca:</strong> {v.brand || "-"}</p>
                    <p className="flex-row"><ClipboardText size={18} /> <strong>Modelo:</strong> {v.model || "-"}</p>
                    <p className="flex-row"><IdentificationCard size={18} /> <strong>Patente:</strong> {(v.plate || "").toUpperCase() || "-"}</p>
                    <p className="flex-row"><Gauge size={18} /> <strong>Capacidad:</strong> {v.capacity != null ? numberFmt(v.capacity) : "-"} </p>
                    <p><CarOutlined /> <strong>Estado:</strong> {statusTag(v.status)}</p>
                </div>
            ))}
        </div>
    );
};

export default VehicleListMobile;
