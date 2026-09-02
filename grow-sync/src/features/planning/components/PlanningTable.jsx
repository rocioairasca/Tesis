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
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";
import {
    ACTIVITY_TAG_STYLES,
    formatPlanningPeriod,
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
const buildStatusMenuItems = (record, { onUpdateStatus, onCancel }, options = {}) => {
    const { includeTransitions = true, includeReopen = true, includeCancel = true } = options;
    const status = record?.status;
    const items = [];

    const addStatusAction = (key, label, nextStatus) => {
        if (status !== nextStatus) {
            items.push({ key, label, onClick: () => onUpdateStatus(record, nextStatus) });
        }
    };

    if (canEdit && includeTransitions) {
        if (status === "planificado" || status === "pendiente") {
            addStatusAction("progress", "Iniciar trabajo", "en_progreso");
            addStatusAction("done", "Completar trabajo", "completado");
        } else if (status === "en_progreso") {
            addStatusAction("done", "Completar trabajo", "completado");
            addStatusAction("pending", "Volver a pendiente", "pendiente");
        }
    }

    if (canEdit && includeReopen && status === "completado") {
        addStatusAction("reopen", "Reabrir planificación", "pendiente");
    }

    if (includeCancel && canEdit && canDisable && status !== "completado" && status !== "cancelado") {
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
    statusTag,
    statusActionLoading,
    getPrimaryStatusAction,
}) => {
    const renderStatusControl = (record) => {
        const effectiveStatus = record.status_effective || record.status;
        const dropdownItems = buildStatusMenuItems(
            record,
            { onUpdateStatus, onCancel },
            { includeReopen: false, includeCancel: false }
        ).filter(item => item.type === "divider" || item.key !== getPrimaryStatusAction?.(record)?.key);
        const primaryAction = getPrimaryStatusAction?.(record);
        const loading = primaryAction && statusActionLoading === `${record.id || record._id}:${primaryAction.status}`;
        const disabled = Boolean(statusActionLoading);
        const tag = statusTag(effectiveStatus);

        return (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", whiteSpace: "nowrap" }}>
                {dropdownItems.length ? (
                    <Dropdown menu={{ items: dropdownItems }} trigger={["click"]} placement="bottomLeft">
                        <button
                            type="button"
                            aria-label={`Cambiar estado ${effectiveStatus}`}
                            style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                            {tag} <span style={{ color: "#6b7280" }}>▾</span>
                        </button>
                    </Dropdown>
                ) : tag}
                {primaryAction && (
                    <Button
                        size="small"
                        type="default"
                        onClick={() => onUpdateStatus(record, primaryAction.status)}
                        loading={loading}
                        disabled={disabled}
                    >
                        {primaryAction.ctaLabel || primaryAction.label}
                    </Button>
                )}
            </div>
        );
    };

    const columns = [
        {
            title: "Cultivo",
            dataIndex: "crop_name",
            render: (_, row) => (
                <Tooltip title={getCropDisplayName(row, cropIx)}>
                    <strong>{getCropDisplayName(row, cropIx)}</strong>
                </Tooltip>
            ),
            ellipsis: true,
            width: 115,
        },
        {
            title: "Actividad",
            dataIndex: "activity_type",
            render: (t) => <Tag style={ACTIVITY_TAG_STYLES[t] || ACTIVITY_TAG_STYLES.otro}>{formatActivity(t)}</Tag>,
            width: 125,
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
            width: 155,
        },
        {
            title: "Período",
            key: "period",
            render: (_, r) => formatPlanningPeriod(r),
            width: 145,
        },
        {
            title: "Estado",
            dataIndex: "status",
            render: (_, row) => renderStatusControl(row),
            width: 210,
        },
        {
            title: "Superficie",
            key: "planned_area_ha",
            render: (_, r) => formatHa(getPlanningArea(r)),
            width: 105,
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
            width: 95,
        },
        {
            title: "Acciones",
            key: "actions",
            width: 110,
            align: "center",
            render: (_, record) => {
                const menuItems = buildStatusMenuItems(
                    record,
                    { onUpdateStatus, onCancel },
                    { includeTransitions: false, includeReopen: true, includeCancel: true }
                );
                return (
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4, minWidth: 96, whiteSpace: "nowrap" }}>
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
