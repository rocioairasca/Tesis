import React from 'react';
import { Button, Popconfirm, Tooltip } from 'antd';
import { EditOutlined, DeleteOutlined, EyeOutlined } from '../../../components/AppIcons';
import { Calendar as CalIcon, User as UserIcon, MapPin, Package, Truck } from '../../../components/AppIcons';
import dayjs from 'dayjs';
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";

const currentUser = JSON.parse(localStorage.getItem("user") || "null");
const canEdit = hasPermission(currentUser, PERMISSIONS.PLANNING_EDIT);
const canDisable = hasPermission(currentUser, PERMISSIONS.PLANNING_DISABLE);

const PlanningListMobile = ({
    list,
    onEdit,
    onView,
    onCancel,
    rowKey,
    userIx,
    vehIx,
    statusTag
}) => {
    return (
        <div className="inventory-cards-container">
            {list.map((r) => {
                const lotsText = (r.lots || []).map(lot => lot.name).filter(Boolean).join(", ") || "-";
                const period = (r.start_at && r.end_at)
                    ? `${dayjs(r.start_at).format("DD/MM/YYYY")} -> ${dayjs(r.end_at).format("DD/MM/YYYY")}`
                    : "-";

                return (
                    <div className="inventory-card" key={rowKey(r)}>
                        <div className="card-header">
                            <h3>{r.title}</h3>
                            <div className="card-icons">
                                <Tooltip title="Ver detalle">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        aria-label={`Ver detalle de ${r.title}`}
                                        icon={<EyeOutlined />}
                                        onClick={() => onView(r)}
                                    />
                                </Tooltip>
                                {canEdit && <Tooltip title="Editar">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        aria-label={`Editar ${r.title}`}
                                        icon={<EditOutlined />}
                                        onClick={() => onEdit(r)}
                                    />
                                </Tooltip>}
                                {canDisable && <Popconfirm
                                    title="Cancelar planificacion"
                                    description="Esta accion no elimina el registro, lo marca como cancelado."
                                    onConfirm={() => onCancel(r)}
                                    okText="Si"
                                    cancelText="No"
                                >
                                    <Tooltip title="Cancelar">
                                        <Button
                                            type="text"
                                            danger
                                            shape="circle"
                                            aria-label={`Cancelar ${r.title}`}
                                            icon={<DeleteOutlined />}
                                        />
                                    </Tooltip>
                                </Popconfirm>}
                            </div>
                        </div>
                        <p className="flex-row"><CalIcon size={18} /> <strong>Periodo:</strong> {period}</p>
                        <p className="flex-row"><MapPin size={18} /> <strong>Lotes:</strong> {lotsText}</p>
                        <p className="flex-row"><UserIcon size={18} /> <strong>Resp.:</strong> {userIx[r.responsible_user] || "-"}</p>
                        <p className="flex-row"><Truck size={18} /> <strong>Vehiculo:</strong> {vehIx[r.vehicle_id] || "-"}</p>
                        <p className="flex-row"><Package size={18} /> <strong>Productos:</strong> {(r.products?.length || 0)} item(s)</p>
                        <p><strong>Estado:</strong> {statusTag(r.status)}</p>
                    </div>
                );
            })}
        </div>
    );
};

export default PlanningListMobile;
