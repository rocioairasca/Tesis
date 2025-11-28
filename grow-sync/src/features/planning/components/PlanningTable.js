/**
 * Componente: PlanningTable
 * Ubicación: src/features/planning/components/PlanningTable.js
 * Descripción:
 *  Componente presentacional para la tabla de planificaciones en versión escritorio.
 *  Maneja la visualización de columnas, tags de estado y acciones.
 */
import React from 'react';
import { Table, Button, Space, Tooltip, Dropdown, Tag } from 'antd';
import { EditOutlined, MoreOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const PlanningTable = ({
    list,
    loading,
    onEdit,
    onView,
    onUpdateStatus,
    onCancel,
    rowKey,
    userIx,
    lotIx,
    vehIx,
    statusTag
}) => {

    const columns = [
        { title: "#", dataIndex: "index", width: 56, render: (_, __, i) => i + 1 },
        { title: "Título", dataIndex: "title" },
        {
            title: "Actividad",
            dataIndex: "activity_type",
            render: (t) => <Tag color="blue">{t ? (t[0].toUpperCase() + t.slice(1)) : "—"}</Tag>,
        },
        {
            title: "Lotes",
            dataIndex: "lots",
            render: (lots = []) => {
                // lots comes as array of {id, name} objects from backend
                const lotNames = lots.map(lot => lot.name).filter(Boolean);
                return lotNames.join(", ") || "—";
            },
        },
        {
            title: "Período",
            key: "period",
            render: (_, r) =>
                r.start_at && r.end_at
                    ? `${dayjs(r.start_at).format("DD/MM/YYYY")} → ${dayjs(r.end_at).format("DD/MM/YYYY")}`
                    : "—",
        },
        {
            title: "Responsable",
            dataIndex: "responsible_user",
            render: (id) => userIx[id] || "—",
        },
        { title: "Vehículo", dataIndex: "vehicle_id", render: (id) => vehIx[id] || "—" },
        {
            title: "Productos",
            dataIndex: "products",
            render: (arr = []) => (arr.length ? `${arr.length} ítem(s)` : "—"),
        },
        { title: "Estado", dataIndex: "status", render: statusTag },
        {
            title: "Acciones",
            key: "actions",
            width: 140,
            render: (_, record) => {
                const menuItems = [
                    { key: "prog", label: "Marcar en progreso", onClick: () => onUpdateStatus(record, "en_progreso") },
                    { key: "done", label: "Marcar completado", onClick: () => onUpdateStatus(record, "completado") },
                    { type: "divider" },
                    {
                        key: "cancel",
                        label: <span style={{ color: "#ff4d4f" }}>Cancelar</span>,
                        onClick: () => onCancel(record),
                    },
                ];
                return (
                    <Space size="small">
                        <Tooltip title="Ver detalle">
                            <Button type="text" shape="circle" icon={<EyeOutlined />} onClick={() => onView(record)} />
                        </Tooltip>
                        <Tooltip title="Editar">
                            <Button type="text" shape="circle" icon={<EditOutlined />} onClick={() => onEdit(record)} />
                        </Tooltip>
                        <Dropdown menu={{ items: menuItems }} placement="bottomRight">
                            <Button type="text" shape="circle" icon={<MoreOutlined />} />
                        </Dropdown>
                    </Space>
                );
            },
        },
    ];

    return (
        <Table
            scroll={{ x: "max-content" }}
            columns={columns}
            dataSource={list}
            loading={loading}
            pagination={{ pageSize: 8, position: ["bottomCenter"] }}
            rowKey={rowKey}
        />
    );
};

export default PlanningTable;
