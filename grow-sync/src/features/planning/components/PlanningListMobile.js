/**
 * Componente: PlanningListMobile
 * Ubicación: src/features/planning/components/PlanningListMobile.js
 * Descripción:
 *  Componente presentacional para la lista de planificaciones en versión móvil.
 *  Renderiza cards con la información clave de cada planificación.
 */
import React from 'react';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { Calendar as CalIcon, User as UserIcon, MapPin, Package, Truck } from 'phosphor-react';
import dayjs from 'dayjs';

const PlanningListMobile = ({
    list,
    onEdit,
    onCancel,
    rowKey,
    userIx,
    vehIx,
    statusTag
}) => {
    return (
        <div className="inventory-cards-container">
            {list.map((r) => {
                // lots comes as array of {id, name} objects from backend
                const lotsText = (r.lots || []).map(lot => lot.name).filter(Boolean).join(", ") || "—";
                const period = (r.start_at && r.end_at)
                    ? `${dayjs(r.start_at).format("DD/MM/YYYY")} → ${dayjs(r.end_at).format("DD/MM/YYYY")}`
                    : "—";
                return (
                    <div className="inventory-card" key={rowKey(r)}>
                        <div className="card-header">
                            <h3>{r.title}</h3>
                            <div className="card-icons">
                                <EditOutlined onClick={() => onEdit(r)} />
                                <DeleteOutlined onClick={() => onCancel(r)} />
                            </div>
                        </div>
                        <p className="flex-row"><CalIcon size={18} /> <strong>Período:</strong> {period}</p>
                        <p className="flex-row"><MapPin size={18} /> <strong>Lotes:</strong> {lotsText}</p>
                        <p className="flex-row"><UserIcon size={18} /> <strong>Resp.:</strong> {userIx[r.responsible_user] || "—"}</p>
                        <p className="flex-row"><Truck size={18} /> <strong>Vehículo:</strong> {vehIx[r.vehicle_id] || "—"}</p>
                        <p className="flex-row"><Package size={18} /> <strong>Productos:</strong> {(r.products?.length || 0)} ítem(s)</p>
                        <p><strong>Estado:</strong> {statusTag(r.status)}</p>
                    </div>
                );
            })}
        </div>
    );
};

export default PlanningListMobile;
