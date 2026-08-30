/**
 * Componente: PlanningTable
 * Ubicación: src/features/planning/components/PlanningTable.jsx
 * Descripción:
 *  Componente presentacional para la tabla de planificaciones en versión escritorio.
 *  Maneja la visualización de columnas, tags de estado y acciones.
 */
import React from 'react';
import { Table, Button, Tooltip, Dropdown, Tag, Modal } from 'antd';
import { EditOutlined, MoreOutlined, EyeOutlined } from '../../../components/AppIcons';
import dayjs from 'dayjs';
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";
import {
    ACTIVITY_TAG_STYLES,
    formatActivity,
    getCropDisplayName,
    summarizePlanningLots,
} from "../planningDisplay";

const currentUser = JSON.parse(localStorage.getItem("user") || "null");
const canEdit = hasPermission(currentUser, PERMISSIONS.PLANNING_EDIT);
const canDisable = hasPermission(currentUser, PERMISSIONS.PLANNING_DISABLE);
const formatHa = (value) => `${Number(value || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
})} ha`;
const getPlanningArea = (row) => {
    const plannedArea = Number(row?.planned_area_ha || 0);
    if (plannedArea > 0) return plannedArea;
    return (row?.lots || []).reduce((sum, lot) => sum + Number(lot?.area_ha || 0), 0);
};
const formatPeriod = (row) => {
    if (!row?.start_at || !row?.end_at) return "—";
    const start = dayjs(row.start_at);
    const end = dayjs(row.end_at);
    return start.isSame(end, "day")
        ? start.format("DD/MM/YYYY")
        : `${start.format("DD/MM/YYYY")} → ${end.format("DD/MM/YYYY")}`;
};
const buildStatusMenuItems = (record, { onUpdateStatus, onCancel }) => {
    const status = record?.status;
    const items = [];

    const addStatusAction = (key, label, nextStatus) => {
        if (status !== nextStatus) {
            items.push({ key, label, onClick: () => onUpdateStatus(record, nextStatus) });
        }
    };

    if (canEdit) {
        if (status === "planificado" || status === "pendiente") {
            addStatusAction("progress", "Marcar en progreso", "en_progreso");
            addStatusAction("done", "Marcar completada", "completado");
        } else if (status === "en_progreso") {
            addStatusAction("done", "Marcar completada", "completado");
            addStatusAction("pending", "Volver a pendiente", "pendiente");
        } else if (status === "completado") {
            addStatusAction("reopen", "Reabrir planificación", "pendiente");
        }
    }

    if (canEdit && canDisable && status !== "completado" && status !== "cancelado") {
        if (items.length) items.push({ type: "divider" });
        items.push({
            key: "cancel",
            danger: true,
            label: "Cancelar",
            onClick: () => Modal.confirm({
                title: "¿Cancelar planificación?",
                content: "Esta acción no elimina el registro, lo marca como cancelado.",
                okText: "Cancelar planificación",
                okButtonProps: { danger: true },
                cancelText: "Volver",
                onOk: () => onCancel(record),
            }),
        });
    }

    return items;
};

const PlanningTable = ({
    list,
    loading,
    onEdit,
    onView,
    onUpdateStatus,
    onCancel,
    rowKey,
    userIx,
    cropIx,
    statusTag
}) => {

    const columns = [
        {
            title: "Cultivo",
            dataIndex: "crop_name",
            render: (_, row) => <strong>{getCropDisplayName(row, cropIx)}</strong>,
            ellipsis: true,
            width: 170,
        },
        {
            title: "Actividad",
            dataIndex: "activity_type",
            render: (t) => <Tag style={ACTIVITY_TAG_STYLES[t] || ACTIVITY_TAG_STYLES.otro}>{formatActivity(t)}</Tag>,
            width: 130,
        },
        {
            title: "Lote/Sublote",
            dataIndex: "lots",
            render: (lots = []) => {
                const summary = summarizePlanningLots(lots);
                return summary.tooltip
                    ? <Tooltip title={<span style={{ whiteSpace: "pre-line" }}>{summary.tooltip}</span>}>{summary.text}</Tooltip>
                    : summary.text;
            },
            ellipsis: true,
        },
        {
            title: "Período",
            key: "period",
            render: (_, r) => formatPeriod(r),
            width: 150,
        },
        {
            title: "Estado",
            dataIndex: "status",
            render: (_, row) => statusTag(row.status_effective || row.status),
            width: 120,
        },
        {
            title: "Superficie",
            key: "planned_area_ha",
            render: (_, r) => formatHa(getPlanningArea(r)),
            width: 110,
        },
        {
            title: "Responsable",
            dataIndex: "responsible_user",
            render: (id) => userIx[id] || "—",
            ellipsis: true,
            width: 140,
        },
        {
            title: "Campaña",
            dataIndex: "campaign_name",
            render: (value) => value || "—",
            responsive: ["lg"],
            width: 110,
        },
        {
            title: "Acciones",
            key: "actions",
            width: 118,
            align: "right",
            render: (_, record) => {
                const menuItems = buildStatusMenuItems(record, { onUpdateStatus, onCancel });
                return (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 2, minWidth: 104, whiteSpace: "nowrap" }}>
                        <Tooltip title="Ver detalle">
                            <Button size="small" type="text" shape="circle" icon={<EyeOutlined />} onClick={() => onView(record)} />
                        </Tooltip>
                        {canEdit && <Tooltip title="Editar">
                            <Button size="small" type="text" shape="circle" icon={<EditOutlined />} onClick={() => onEdit(record)} />
                        </Tooltip>}
                        {menuItems.length > 0 && <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={["click"]}>
                            <Button size="small" type="text" shape="circle" icon={<MoreOutlined />} aria-label="Más acciones" />
                        </Dropdown>}
                    </div>
                );
            },
        },
    ];

    return (
        <Table
            columns={columns}
            dataSource={list}
            loading={loading}
            size="small"
            tableLayout="fixed"
            pagination={{ pageSize: 8, position: ["bottomCenter"] }}
            rowKey={rowKey}
        />
    );
};

export default PlanningTable;
