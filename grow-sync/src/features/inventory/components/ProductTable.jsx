/**
 * Componente: ProductTable
 * Ubicación: src/features/inventory/components/ProductTable.jsx
 * Descripción:
 *  Componente presentacional para la tabla de productos en versión escritorio.
 *  Maneja la visualización de columnas, formateo de datos (fechas, monedas) y acciones.
 */
import React from 'react';
import { Table, Button, Space, Tooltip, Popconfirm, Tag } from 'antd';
import { EditOutlined, DeleteOutlined, ExclamationCircleOutlined, PlusOutlined } from '../../../components/AppIcons';

import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";

const currentUser = JSON.parse(localStorage.getItem("user") || "null");

const canDisable = hasPermission(
  currentUser,
  PERMISSIONS.INVENTORY_DISABLE
);

const canEdit = hasPermission(
  currentUser,
  PERMISSIONS.INVENTORY_EDIT
);

const ProductTable = ({
    products,
    loading,
    onEdit,
    onAddStock,
    onDelete,
    rowKey,
    getId,
    formatUnit,
    formatDateDDMMYYYY,
    isExpired,
    isExpiringSoon,
    expirationValue,
    pagination,
    onPaginationChange,
}) => {

    const columns = [
        {
            title: "Nombre",
            dataIndex: "name",
            key: "name",
            sorter: (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es", { sensitivity: "base" }),
            defaultSortOrder: "ascend",
        },
        {
            title: "Cantidad Total",
            dataIndex: "total_quantity",
            key: "total_quantity",
            sorter: (a, b) => Number(a.total_quantity || 0) - Number(b.total_quantity || 0),
        },
        {
            title: "Cantidad Disponible",
            dataIndex: "available_quantity",
            key: "available_quantity",
            render: (v, r) => (v > 0 ? v : <Tag color="red">Agotado</Tag>),
            sorter: (a, b) => Number(a.available_quantity || 0) - Number(b.available_quantity || 0),
        },
        {
            title: "Unidad", dataIndex: "unit", key: "unit",
            render: (u) => formatUnit(u),
            sorter: (a, b) => String(a.unit || "").localeCompare(String(b.unit || ""), "es", { sensitivity: "base" }),
        },
        {
            title: "Fecha de Vencimiento",
            dataIndex: "acquisition_date",
            key: "acquisition_date",
            sorter: (a, b) => {
                const dateA = expirationValue(a);
                const dateB = expirationValue(b);
                if (!dateA && !dateB) return 0;
                if (!dateA) return 1;
                if (!dateB) return -1;
                return new Date(dateA).getTime() - new Date(dateB).getTime();
            },
            render: (_, record) => {
                const d = expirationValue(record);
                const expired = isExpired(d);
                const soon = isExpiringSoon(d);
                return (
                    <Space size={6}>
                        <span>{formatDateDDMMYYYY(d)}</span>
                        {expired && (
                            <Tooltip title="Vencido">
                                <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />
                            </Tooltip>
                        )}
                        {!expired && soon && (
                            <Tooltip title="Próximo a vencer">
                                <ExclamationCircleOutlined style={{ color: "#faad14" }} />
                            </Tooltip>
                        )}
                    </Space>
                );
            },
        },
        {
            title: "Acciones",
            key: "actions",
            width: 180,
            render: (_, record) => (
                <Space size="small">
                    {canEdit && (
                        <Button
                            type="link"
                            icon={<PlusOutlined />}
                            onClick={() => onAddStock(record)}
                        >
                            Agregar stock
                        </Button>
                    )}

                    <Tooltip title="Editar">
                        {canEdit && (
                            <Button
                                type="text"
                                shape="circle"
                                icon={<EditOutlined />}
                                aria-label="Editar"
                                onClick={() => onEdit(record)}
                            />
                        )}
                    </Tooltip>

                    <Popconfirm
                        title="¿Deshabilitar este producto?"
                        okText="Sí"
                        cancelText="No"
                        onConfirm={() => onDelete(getId(record))}
                    >
                        <Tooltip title="Deshabilitar">
                            {canDisable && (
                                <Button
                                    type="text"
                                    danger
                                    shape="circle"
                                    icon={<DeleteOutlined />}
                                    aria-label="Deshabilitar"
                                />
                            )}
                        </Tooltip>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <Table
            scroll={{ x: "max-content" }}
            columns={columns}
            dataSource={products}
            loading={loading}
            pagination={{
                current: pagination.current,
                pageSize: 10,
                showSizeChanger: false,
                position: ["bottomCenter"],
            }}
            onChange={onPaginationChange}
            rowKey={rowKey}
        />
    );
};

export default ProductTable;
