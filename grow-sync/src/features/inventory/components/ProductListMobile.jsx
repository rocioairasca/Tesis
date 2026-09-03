/**
 * Componente: ProductListMobile
 * Ubicación: src/features/inventory/components/ProductListMobile.jsx
 * Descripción:
 *  Componente presentacional para la lista de productos en versión móvil.
 *  Utiliza tarjetas (cards) para mostrar la información de manera responsive.
 */
import React from 'react';
import { Button, Popconfirm, Tag, Tooltip } from 'antd';
import {
    EditOutlined, DeleteOutlined, AppstoreOutlined, InboxOutlined,
    CalendarOutlined, ExclamationCircleOutlined, PlusOutlined
} from '../../../components/AppIcons';
import { PERMISSIONS } from "../../../constants/permissions";
import { hasPermission } from "../../../utils/permissions";

const currentUser = JSON.parse(localStorage.getItem("user") || "null");
const canDisable = hasPermission(currentUser, PERMISSIONS.INVENTORY_DISABLE);
const canEdit = hasPermission(currentUser, PERMISSIONS.INVENTORY_EDIT);

const ProductListMobile = ({
    products,
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
}) => {
    return (
        <div className="inventory-cards-container">
            {products.map((product) => {
                return (
                    <div className="inventory-card" key={rowKey(product)}>
                        <div className="card-header">
                            <h3>{product.name}</h3>
                            <div className="card-icons">
                                {canEdit && <Tooltip title="Agregar stock">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        aria-label={`Agregar stock a ${product.name}`}
                                        icon={<PlusOutlined />}
                                        onClick={() => onAddStock(product)}
                                    />
                                </Tooltip>}
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
                            <AppstoreOutlined /> <strong>Categoría:</strong> {product.category || "—"}
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

                        <p>
                            <CalendarOutlined /> <strong>Vence:</strong>{" "}
                            {formatDateDDMMYYYY(expirationValue(product))}{" "}
                            {/* ícono de alerta en mobile */}
                            {isExpired(expirationValue(product)) && (
                                <ExclamationCircleOutlined style={{ color: "#ff4d4f", marginLeft: 6 }} />
                            )}
                            {!isExpired(expirationValue(product)) && isExpiringSoon(expirationValue(product)) && (
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
