import React from 'react';
import { Button, Dropdown, Modal, Tooltip } from 'antd';
import { EditOutlined, EyeOutlined, MoreOutlined } from '../../../components/AppIcons';
import { Calendar as CalIcon, User as UserIcon, MapPin } from '../../../components/AppIcons';
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";
import {
    formatActivity,
    formatPlanningPeriod,
    getPlanningDisplayName,
    getPlanningLotName,
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

const PlanningListMobile = ({
    list,
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
    return (
        <div className="inventory-cards-container">
            {list.map((r) => {
                const lotsText = (r.lots || []).map(getPlanningLotName).filter(Boolean).join(", ") || "-";
                const period = formatPlanningPeriod(r, "-");
                const primaryAction = getPrimaryStatusAction?.(r);
                const menuItems = buildStatusMenuItems(
                    r,
                    { onUpdateStatus, onCancel },
                    { includeTransitions: false, includeReopen: true, includeCancel: true }
                );
                const statusDropdownItems = buildStatusMenuItems(
                    r,
                    { onUpdateStatus, onCancel },
                    { includeReopen: false, includeCancel: false }
                ).filter(item => item.type === "divider" || item.key !== primaryAction?.key);
                const actionLoading = primaryAction && statusActionLoading === `${r.id || r._id}:${primaryAction.status}`;
                const actionsDisabled = Boolean(statusActionLoading);

                return (
                    <div
                        className="inventory-card"
                        key={rowKey(r)}
                        onClick={() => onView(r)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") onView(r);
                        }}
                        role="button"
                        tabIndex={0}
                    >
                        <div className="card-header">
                            <h3>{getPlanningDisplayName(r, cropIx)}</h3>
                            <div className="card-icons" onClick={(event) => event.stopPropagation()}>
                                <Tooltip title="Ver detalle">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        aria-label={`Ver detalle de ${getPlanningDisplayName(r, cropIx)}`}
                                        icon={<EyeOutlined />}
                                        onClick={() => onView(r)}
                                    />
                                </Tooltip>
                                {canEdit && <Tooltip title="Editar">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        aria-label={`Editar ${getPlanningDisplayName(r, cropIx)}`}
                                        icon={<EditOutlined />}
                                        onClick={() => onEdit(r)}
                                    />
                                </Tooltip>}
                                {menuItems.length > 0 && (
                                    <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={["click"]}>
                                        <Button
                                            type="text"
                                            shape="circle"
                                            aria-label={`Más acciones para ${getPlanningDisplayName(r, cropIx)}`}
                                            icon={<MoreOutlined />}
                                        />
                                    </Dropdown>
                                )}
                            </div>
                        </div>
                        <div
                            style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 12px" }}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <strong>Estado:</strong>
                            {statusDropdownItems.length ? (
                                <Dropdown menu={{ items: statusDropdownItems }} placement="bottomLeft" trigger={["click"]}>
                                    <button
                                        type="button"
                                        aria-label={`Cambiar estado ${r.status_effective || r.status}`}
                                        style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer" }}
                                    >
                                        {statusTag(r.status_effective || r.status)} <span style={{ color: "#6b7280" }}>▾</span>
                                    </button>
                                </Dropdown>
                            ) : statusTag(r.status_effective || r.status)}
                        </div>
                        <p className="flex-row"><MapPin size={18} /> <strong>Lotes:</strong> {lotsText}</p>
                        <p className="flex-row"><MapPin size={18} /> <strong>Superficie:</strong> {formatHa(getPlanningArea(r))}</p>
                        <p className="flex-row"><CalIcon size={18} /> <strong>Período:</strong> {period}</p>
                        <p className="flex-row"><UserIcon size={18} /> <strong>Resp.:</strong> {userIx[r.responsible_user] || "-"}</p>
                        {primaryAction && (
                            <div style={{ marginTop: 12 }} onClick={(event) => event.stopPropagation()}>
                                <Button
                                    type="primary"
                                    block
                                    loading={actionLoading}
                                    disabled={actionsDisabled}
                                    onClick={() => onUpdateStatus(r, primaryAction.status)}
                                >
                                    {primaryAction.label}
                                </Button>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default PlanningListMobile;
