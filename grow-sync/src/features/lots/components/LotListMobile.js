/**
 * Componente: LotListMobile
 * Ubicación: src/features/lots/components/LotListMobile.js
 * Descripción:
 *  Este componente maneja la visualización de lotes en dispositivos móviles.
 *  Reemplaza la tabla por una lista de tarjetas (cards) para mejorar la UX en pantallas pequeñas.
 *  Al igual que LotTable, es un componente presentacional que recibe datos y acciones vía props.
 * 
 * Cambios recientes:
 *  - Extracción de la vista móvil desde Lotes.js.
 *  - Organización del código para separar responsabilidades de UI.
 */
import React from 'react';
import { Button } from 'antd';
import { EditOutlined, DeleteOutlined, AimOutlined, EnvironmentOutlined } from '@ant-design/icons';

const LotListMobile = ({
    lots,
    onEdit,
    onDelete,
    onViewLocation,
    rowKey,
    getId,
    safeParse
}) => {
    return (
        <div className="inventory-cards-container">
            {lots.map((lot) => (
                <div className="inventory-card" key={rowKey(lot)}>
                    <div className="card-header">
                        <h3>{lot.name}</h3>
                        <div className="card-icons">
                            <EditOutlined onClick={() => onEdit(lot)} />
                            <DeleteOutlined onClick={() => onDelete(getId(lot))} />
                        </div>
                    </div>

                    <p>
                        <AimOutlined style={{ marginRight: 8 }} /> <strong>Área:</strong> {lot.area} ha
                    </p>
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
            ))}
        </div>
    );
};

export default LotListMobile;
