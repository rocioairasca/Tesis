/**
 * Componente: VehicleTable
 * Ubicación: src/features/vehicles/components/VehicleTable.js
 * Descripción:
 *  Componente presentacional para la tabla de vehículos en versión escritorio.
 *  Maneja la visualización de columnas, tags de estado y acciones.
 */
import React from 'react';
import { Table, Button, Space, Tooltip, Popconfirm, Tag } from 'antd';
import { EditOutlined, DeleteOutlined } from '../../../components/AppIcons';
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";

const currentUser = JSON.parse(localStorage.getItem("user") || "null");
const canEdit = hasPermission(currentUser, PERMISSIONS.VEHICLES_EDIT);
const canDisable = hasPermission(currentUser, PERMISSIONS.VEHICLES_DISABLE);

const VehicleTable = ({
    vehicles,
    loading,
    onEdit,
    onDisable,
    rowKey,
    getId,
    statusTag,
    numberFmt
}) => {

    const columns = [
        (canEdit || canDisable) && {
            title: "#",
            dataIndex: "index",
            key: "index",
            width: 64,
            render: (_, __, index) => index + 1,
        },
        { title: "Nombre", dataIndex: "name", key: "name" },
        {
            title: "Tipo",
            dataIndex: "type",
            key: "type",
            render: (t) => t ? <Tag color="blue">{t[0].toUpperCase() + t.slice(1)}</Tag> : "—",
        },
        { title: "Marca", dataIndex: "brand", key: "brand" },
        { title: "Modelo", dataIndex: "model", key: "model" },
        {
            title: "Patente",
            dataIndex: "plate",
            key: "plate",
            render: (p) => (p ? String(p).toUpperCase() : "—"),
        },
        {
            title: "Capacidad",
            dataIndex: "capacity",
            key: "capacity",
            render: (v) => (v != null ? `${numberFmt(v)}` : "—"),
        },
        {
            title: "Estado",
            dataIndex: "status",
            key: "status",
            render: (s) => statusTag(s),
        },
        {
            title: "Acciones",
            key: "actions",
            width: 96,
            render: (_, record) => (
                <Space size="small">
                    {canEdit && <Tooltip title="Editar">
                        <Button
                            type="text"
                            shape="circle"
                            aria-label="Editar"
                            icon={<EditOutlined />}
                            onClick={() => onEdit(record)}
                        />
                    </Tooltip>}
                    {canDisable && <Popconfirm
                        title="¿Deshabilitar este vehículo?"
                        okText="Sí"
                        cancelText="No"
                        onConfirm={() => onDisable(getId(record))}
                    >
                        <Tooltip title="Deshabilitar">
                            <Button
                                type="text"
                                danger
                                shape="circle"
                                aria-label="Deshabilitar"
                                icon={<DeleteOutlined />}
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
            dataSource={vehicles}
            loading={loading}
            pagination={{ pageSize: 8, position: ["bottomCenter"] }}
            rowKey={rowKey}
        />
    );
};

export default VehicleTable;
