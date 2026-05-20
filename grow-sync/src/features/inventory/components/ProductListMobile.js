/**
 * Componente: ProductListMobile
 * Ubicación: src/features/inventory/components/ProductListMobile.js
 * Descripción:
 *  Componente presentacional para la lista de productos en versión móvil.
 *  Utiliza tarjetas (cards) para mostrar la información de manera responsive.
 */
import React from 'react';
import { Button, Popconfirm, Tag, Tooltip } from 'antd';
import {
    EditOutlined, DeleteOutlined, AppstoreOutlined, InboxOutlined,
    DollarOutlined, CalendarOutlined, ExclamationCircleOutlined
} from '../../../components/AppIcons';
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";

const currentUser = JSON.parse(localStorage.getItem("user") || "null");
const canDisable = hasPermission(currentUser, PERMISSIONS.INVENTORY_DISABLE);
const canEdit = hasPermission(currentUser, PERMISSIONS.INVENTORY_EDIT);

const ProductListMobile = ({
    products,
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
    return (
        <div className="inventory-cards-container">
            {products.map((product) => {
                return (
                    <div className="inventory-card" key={rowKey(product)}>
                        <div className="card-header">
                            <h3>{product.name}</h3>
                            <div className="card-icons">
                                {canEdit && <Tooltip title="Editar">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        aria-label={`Editar ${product.name}`}
                                        icon={<EditOutlined />}
                                        onClick={() => onEdit(product)}
                                    />
                                </Tooltip>}
                                {canDisable && <Popconfirm
                                    title="Deshabilitar producto"
                                    description="Esta accion se puede revertir desde productos deshabilitados."
                                    okText="Si"
                                    cancelText="No"
                                    onConfirm={() => onDelete(getId(product))}
                                >
                                    <Tooltip title="Deshabilitar">
                                        <Button
                                            type="text"
                                            danger
                                            shape="circle"
                                            aria-label={`Deshabilitar ${product.name}`}
                                            icon={<DeleteOutlined />}
                                        />
                                    </Tooltip>
                                </Popconfirm>}
                            </div>
                        </div>

                        <p>
                            <AppstoreOutlined /> <strong>Tipo:</strong> {product.type}
                        </p>
                        <p><InboxOutlined /> <strong>Total:</strong> {product.total_quantity} {formatUnit(product.unit)}</p>
                        <p>
                            <InboxOutlined /> <strong>Disponible:</strong>{" "}
                            <Tag
                                color={
                                    product.available_quantity === 0
                                        ? "red"
                                        : product.available_quantity < product.total_quantity * 0.3
                                            ? "orange"
                                            : "green"
                                }
                            >
                                {product.available_quantity} {formatUnit(product.unit)}
                            </Tag>
                        </p>

                        <p><DollarOutlined /> <strong>Precio:</strong> {formatCurrency(product.price)}</p>

                        <p>
                            <CalendarOutlined /> <strong>Vence:</strong>{" "}
                            {formatDateDDMMYYYY(product.acquisition_date)}{" "}
                            {/* ícono de alerta en mobile */}
                            {isExpired(product.acquisition_date) && (
                                <ExclamationCircleOutlined style={{ color: "#ff4d4f", marginLeft: 6 }} />
                            )}
                            {!isExpired(product.acquisition_date) && isExpiringSoon(product.acquisition_date) && (
                                <ExclamationCircleOutlined style={{ color: "#faad14", marginLeft: 6 }} />
                            )}
                        </p>
                    </div>
                );
            })}
        </div>
    );
};

export default ProductListMobile;
