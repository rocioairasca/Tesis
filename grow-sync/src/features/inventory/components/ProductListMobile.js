/**
 * Componente: ProductListMobile
 * Ubicación: src/features/inventory/components/ProductListMobile.js
 * Descripción:
 *  Componente presentacional para la lista de productos en versión móvil.
 *  Utiliza tarjetas (cards) para mostrar la información de manera responsive.
 */
import React from 'react';
import { Tag } from 'antd';
import {
    EditOutlined, DeleteOutlined, AppstoreOutlined, InboxOutlined,
    DollarOutlined, CalendarOutlined, ExclamationCircleOutlined
} from "@ant-design/icons";

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
                                <EditOutlined onClick={() => onEdit(product)} />
                                <DeleteOutlined onClick={() => onDelete(getId(product))} />
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
