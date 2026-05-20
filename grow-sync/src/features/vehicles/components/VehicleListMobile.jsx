/**
 * Componente: VehicleListMobile
 * Ubicación: src/features/vehicles/components/VehicleListMobile.jsx
 * Descripción:
 *  Componente presentacional para la lista de vehículos en versión móvil.
 *  Utiliza tarjetas (cards) para mostrar la información de manera responsive.
 */
import React from 'react';
import { EditOutlined, DeleteOutlined, CarOutlined } from '../../../components/AppIcons';
import { Truck, IdentificationCard, ClipboardText, Gauge } from '../../../components/AppIcons';
import { Button, Popconfirm, Tooltip } from 'antd';
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";

const currentUser = JSON.parse(localStorage.getItem("user") || "null");
const canEdit = hasPermission(currentUser, PERMISSIONS.VEHICLES_EDIT);
const canDisable = hasPermission(currentUser, PERMISSIONS.VEHICLES_DISABLE);

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
                            {canEdit && <Tooltip title="Editar">
                                <Button
                                    type="text"
                                    shape="circle"
                                    aria-label={`Editar ${v.name}`}
                                    icon={<EditOutlined />}
                                    onClick={() => onEdit(v)}
                                />
                            </Tooltip>}
                            {canDisable && <Popconfirm
                                title="Deshabilitar vehiculo"
                                description="Esta accion se puede revertir desde vehiculos deshabilitados."
                                okText="Si"
                                cancelText="No"
                                onConfirm={() => onDisable(getId(v))}
                            >
                                <Tooltip title="Deshabilitar">
                                    <Button
                                        type="text"
                                        danger
                                        shape="circle"
                                        aria-label={`Deshabilitar ${v.name}`}
                                        icon={<DeleteOutlined />}
                                    />
                                </Tooltip>
                            </Popconfirm>}
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
