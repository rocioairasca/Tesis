/**
 * Componente: LotTable
 * Ubicación: src/features/lots/components/LotTable.jsx
 * Descripción: 
 *  Este componente fue extraído de Lotes.jsx para modularizar la vista de escritorio.
 *  Se encarga de renderizar la tabla de Ant Design con los lotes.
 *  Recibe las funciones de acción (editar, eliminar, ver ubicación) como props
 *  para mantener la lógica en el contenedor padre (Lotes.jsx).
 * 
 * Cambios recientes:
 *  - Extracción de la lógica de renderizado de la tabla.
 *  - Desacoplamiento de la lógica de estado principal.
 */
import React from 'react';
import { Table, Button, Space, Tooltip, Popconfirm, Typography } from 'antd';
import { EditOutlined, DeleteOutlined, FormOutlined } from '../../../components/AppIcons';
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";

const currentUser = JSON.parse(localStorage.getItem("user") || "null");
const canEdit = hasPermission(currentUser, PERMISSIONS.LOTS_EDIT);
const canDisable = hasPermission(currentUser, PERMISSIONS.LOTS_DISABLE);
const { Text } = Typography;

const formatHa = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const getActiveSubLots = (lot) => (
    Array.isArray(lot?.active_layout?.sub_lots) ? lot.active_layout.sub_lots : []
);

const LotTable = ({
    lots,
    loading,
    onEdit,
    onDelete,
    onViewLocation,
    onManageDivisions,
    rowKey,
    getId,
    safeParse
}) => {

    const columns = [
        {
            title: "Nombre del Lote",
            dataIndex: "name",
            key: "name",
            render: (_, record) => {
                const subLots = getActiveSubLots(record);
                return (
                    <Space direction="vertical" size={4}>
                        <Text strong>{record.name}</Text>
                        {subLots.map((subLot) => (
                            <Text key={subLot.id} type="secondary" style={{ paddingLeft: 18 }}>
                                ↳ {subLot.name}
                            </Text>
                        ))}
                    </Space>
                );
            },
        },
        {
            title: "Área Total (ha)",
            dataIndex: "area",
            key: "area",
            render: (_, record) => {
                const subLots = getActiveSubLots(record);
                return (
                    <Space direction="vertical" size={4}>
                        <Text>{formatHa(record.area_ha || record.area)} ha</Text>
                        {subLots.map((subLot) => (
                            <Text key={subLot.id} type="secondary" style={{ paddingLeft: 18 }}>
                                {formatHa(subLot.area_ha)} ha
                            </Text>
                        ))}
                    </Space>
                );
            },
        },
        {
            title: "Ubicación",
            dataIndex: "location",
            key: "location",
            render: (loc) => {
                const parsed = safeParse(loc);
                if (!parsed) return "Sin ubicación";
                return (
                    <Button type="link" onClick={() => onViewLocation(parsed)}>
                        Ver
                    </Button>
                );
            },
        },
        (canEdit || canDisable) && {
            title: "Acciones",
            key: "actions",
            width: 96,
            render: (_, record) => (
                <Space size="small">
                    {canEdit && <Tooltip title="Editar">
                        <Button
                            type="text"
                            shape="circle"
                            icon={<EditOutlined />}
                            onClick={() => onEdit(record)}
                            aria-label="Editar"
                        />
                    </Tooltip>}
                    {canEdit && <Tooltip title="Gestionar divisiones">
                        <Button
                            type="text"
                            shape="circle"
                            icon={<FormOutlined />}
                            onClick={() => onManageDivisions(record)}
                            aria-label="Gestionar divisiones"
                        />
                    </Tooltip>}
                    {canDisable && <Popconfirm
                        title="¿Deshabilitar este lote?"
                        okText="Sí"
                        cancelText="No"
                        onConfirm={() => onDelete(getId(record))}
                    >
                        <Tooltip title="Deshabilitar">
                            <Button
                                type="text"
                                danger
                                shape="circle"
                                icon={<DeleteOutlined />}
                                aria-label="Deshabilitar"
                            />
                        </Tooltip>
                    </Popconfirm>}
                </Space>
            ),
        },
    ].filter(Boolean);

    return (
        <Table
            scroll={{ x: "max-content" }}
            columns={columns}
            dataSource={lots}
            loading={loading}
            pagination={{ pageSize: 5, position: ['bottomCenter'] }}
            rowKey={rowKey}
        />
    );
};

export default LotTable;
