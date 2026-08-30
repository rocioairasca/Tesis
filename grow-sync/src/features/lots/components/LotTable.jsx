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
import { Table, Button, Space, Tooltip, Popconfirm, Typography, Tag } from 'antd';
import { EditOutlined, DeleteOutlined, FormOutlined } from '../../../components/AppIcons';
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";

const currentUser = JSON.parse(localStorage.getItem("user") || "null");
const canEdit = hasPermission(currentUser, PERMISSIONS.LOTS_EDIT);
const canDisable = hasPermission(currentUser, PERMISSIONS.LOTS_DISABLE);
const { Text } = Typography;

const formatHa = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('es-AR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '0,00';
};

const getActiveSubLots = (lot) => (
    Array.isArray(lot?.active_layout?.sub_lots) ? lot.active_layout.sub_lots : []
);

const getUnitCropName = (unit) => unit?.current_crop?.crop_name || null;
const formatCropCount = (count) => `${count} ${count === 1 ? 'cultivo' : 'cultivos'}`;

const LotTable = ({
    lots,
    loading,
    onEdit,
    onDelete,
    onViewLocation,
    onManageDivisions,
    rowKey,
    getId,
    safeParse,
    productiveStates = {},
    productiveStatesAvailable = true
}) => {
    const renderProductiveState = (record) => {
        if (!productiveStatesAvailable) {
            return <Text type="secondary">No disponible</Text>;
        }

        const state = productiveStates[getId(record)];
        const units = Array.isArray(state?.units) ? state.units : [];

        if (!units.length) return <Text type="secondary">Sin cultivo</Text>;

        const currentUnits = units.filter((unit) => unit.current_crop?.crop_name);
        if (!currentUnits.length) return <Text type="secondary">Sin cultivo</Text>;

        if (state.mode === 'sub_lots') {
            const subLots = getActiveSubLots(record);
            const unitBySubLotId = new Map(units.map((unit) => [unit.sub_lot_id, unit]));
            const cropNames = currentUnits.map(getUnitCropName).filter(Boolean);
            const uniqueCrops = Array.from(new Set(cropNames));
            const allSubLotsHaveSameCrop = subLots.length > 0
                && subLots.every((subLot) => getUnitCropName(unitBySubLotId.get(subLot.id)) === uniqueCrops[0])
                && uniqueCrops.length === 1;

            return (
                <Space direction="vertical" size={4}>
                    {allSubLotsHaveSameCrop ? (
                        <Text>{uniqueCrops[0]}</Text>
                    ) : (
                        <Tag color="green">{formatCropCount(uniqueCrops.length || currentUnits.length)}</Tag>
                    )}
                    {subLots.map((subLot) => {
                        const cropName = getUnitCropName(unitBySubLotId.get(subLot.id));
                        return (
                            <Text key={subLot.id} type="secondary" style={{ paddingLeft: 18 }}>
                                {cropName || 'Sin cultivo'}
                            </Text>
                        );
                    })}
                    {subLots.length === 0 && currentUnits.slice(0, 2).map((unit) => (
                        <Text key={unit.sub_lot_id || unit.name} type="secondary" style={{ paddingLeft: 18 }}>
                            {unit.current_crop.crop_name}
                        </Text>
                    ))}
                    {subLots.length === 0 && currentUnits.length > 2 && (
                        <Text type="secondary">+ {currentUnits.length - 2} más</Text>
                    )}
                </Space>
            );
        }

        const unit = currentUnits[0];
        return (
            <Space direction="vertical" size={4}>
                <Text>{unit.current_crop.crop_name}</Text>
                {unit.current_crop.campaign_name && (
                    <Text type="secondary">{unit.current_crop.campaign_name}</Text>
                )}
            </Space>
        );
    };

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
            title: "Estado productivo",
            key: "productive_state",
            render: (_, record) => renderProductiveState(record),
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
