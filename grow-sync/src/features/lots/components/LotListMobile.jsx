/**
 * Componente: LotListMobile
 * Ubicación: src/features/lots/components/LotListMobile.jsx
 * Descripción:
 *  Este componente maneja la visualización de lotes en dispositivos móviles.
 *  Reemplaza la tabla por una lista de tarjetas (cards) para mejorar la UX en pantallas pequeñas.
 *  Al igual que LotTable, es un componente presentacional que recibe datos y acciones vía props.
 * 
 * Cambios recientes:
 *  - Extracción de la vista móvil desde Lotes.jsx.
 *  - Organización del código para separar responsabilidades de UI.
 */
import React from 'react';
import { Button, Popconfirm, Tooltip } from 'antd';
import { EditOutlined, DeleteOutlined, AimOutlined, EnvironmentOutlined, FormOutlined } from '../../../components/AppIcons';
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";

const currentUser = JSON.parse(localStorage.getItem("user") || "null");
const canEdit = hasPermission(currentUser, PERMISSIONS.LOTS_EDIT);
const canDisable = hasPermission(currentUser, PERMISSIONS.LOTS_DISABLE);

const formatHa = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const getActiveSubLots = (lot) => (
    Array.isArray(lot?.active_layout?.sub_lots) ? lot.active_layout.sub_lots : []
);

const LotListMobile = ({
    lots,
    onEdit,
    onDelete,
    onViewLocation,
    onManageDivisions,
    rowKey,
    getId,
    safeParse
}) => {
    return (
        <div className="inventory-cards-container">
            {lots.map((lot) => {
                const subLots = getActiveSubLots(lot);

                return (
                <div className="inventory-card" key={rowKey(lot)}>
                    <div className="card-header">
                        <h3>{lot.name}</h3>
                        <div className="card-icons">
                            {canEdit && <Tooltip title="Editar">
                                <Button
                                    type="text"
                                    shape="circle"
                                    aria-label={`Editar ${lot.name}`}
                                    icon={<EditOutlined />}
                                    onClick={() => onEdit(lot)}
                                />
                            </Tooltip>}
                            {canEdit && <Tooltip title="Gestionar divisiones">
                                <Button
                                    type="text"
                                    shape="circle"
                                    aria-label={`Gestionar divisiones de ${lot.name}`}
                                    icon={<FormOutlined />}
                                    onClick={() => onManageDivisions(lot)}
                                />
                            </Tooltip>}
                            {canDisable && <Popconfirm
                                title="Deshabilitar lote"
                                description="Esta accion se puede revertir desde lotes deshabilitados."
                                okText="Si"
                                cancelText="No"
                                onConfirm={() => onDelete(getId(lot))}
                            >
                                <Tooltip title="Deshabilitar">
                                    <Button
                                        type="text"
                                        danger
                                        shape="circle"
                                        aria-label={`Deshabilitar ${lot.name}`}
                                        icon={<DeleteOutlined />}
                                    />
                                </Tooltip>
                            </Popconfirm>}
                        </div>
                    </div>

                    <p>
                        <AimOutlined style={{ marginRight: 8 }} /> <strong>Área:</strong> {formatHa(lot.area_ha || lot.area)} ha
                    </p>
                    {subLots.length > 0 ? (
                        <div style={{ margin: '8px 0 10px', paddingLeft: 4 }}>
                            <strong>Sublotes</strong>
                            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                                {subLots.map((subLot) => (
                                    <li key={subLot.id}>
                                        {subLot.name} — {formatHa(subLot.area_ha)} ha
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    <p>
                        <EnvironmentOutlined style={{ marginRight: 8 }} /> <strong>Ubicación:</strong>{" "}
                        {safeParse(lot.location) ? (
                            <Button
                                type="link"
                                size="small"
                                style={{ padding: 0, marginLeft: 0 }}
                                onClick={() => onViewLocation(safeParse(lot.location))}
                            >
                                Ver
                            </Button>
                        ) : (
                            "No asignada"
                        )}
                    </p>
                </div>
                );
            })}
        </div>
    );
};

export default LotListMobile;
