/**
 * Componente: ProductTable
 * Ubicación: src/features/inventory/components/ProductTable.js
 * Descripción:
 *  Componente presentacional para la tabla de productos en versión escritorio.
 *  Maneja la visualización de columnas, formateo de datos (fechas, monedas) y acciones.
 */
import React from 'react';
import { Table, Button, Space, Tooltip, Popconfirm, Tag } from 'antd';
import { EditOutlined, DeleteOutlined, ExclamationCircleOutlined } from '@ant-design/icons';

const ProductTable = ({
    products,
    loading,
    onEdit,
    onDelete,
    rowKey,
    getId,
    formatUnit,
    formatCurrency,
    formatDateDDMMYYYY,
    isExpired,
    isExpiringSoon
}) => {

    const columns = [
        {
            title: "#",
            dataIndex: "index",
            key: "index",
            render: (_, __, index) => index + 1,
            width: 64,
        },
        { title: "Nombre", dataIndex: "name", key: "name" },
        {
            title: "Cantidad Total",
            dataIndex: "total_quantity",
            key: "total_quantity",
        },
        {
            title: "Cantidad Disponible",
            dataIndex: "available_quantity",
            key: "available_quantity",
            render: (v, r) => (v > 0 ? v : <Tag color="red">Agotado</Tag>),
        },
        {
            title: "Unidad", dataIndex: "unit", key: "unit",
            render: (u) => formatUnit(u),
        },
        {
            title: "Precio",
            dataIndex: "price",
            key: "price",
            render: (v) => formatCurrency(v),
        },
        {
            title: "Fecha de Vencimiento",
            dataIndex: "acquisition_date",
            key: "acquisition_date",
            render: (d) => {
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
            width: 96,
            render: (_, record) => (
                <Space size="small">
                    <Tooltip title="Editar">
                        <Button
                            type="text"
                            shape="circle"
                            icon={<EditOutlined />}
                            aria-label="Editar"
                            onClick={() => onEdit(record)}
                        />
                    </Tooltip>

                    <Popconfirm
                        title="¿Deshabilitar este producto?"
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
            pagination={{ pageSize: 5, position: ["bottomCenter"] }}
            rowKey={rowKey}
        />
    );
};

export default ProductTable;
