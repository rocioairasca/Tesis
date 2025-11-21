/**
 * Componente: LotTable
 * Ubicación: src/features/lots/components/LotTable.js
 * Descripción: 
 *  Este componente fue extraído de Lotes.js para modularizar la vista de escritorio.
 *  Se encarga de renderizar la tabla de Ant Design con los lotes.
 *  Recibe las funciones de acción (editar, eliminar, ver ubicación) como props
 *  para mantener la lógica en el contenedor padre (Lotes.js).
 * 
 * Cambios recientes:
 *  - Extracción de la lógica de renderizado de la tabla.
 *  - Desacoplamiento de la lógica de estado principal.
 */
import React from 'react';
import { Table, Button, Space, Tooltip, Popconfirm } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';

const LotTable = ({
    lots,
    loading,
    onEdit,
    onDelete,
    onViewLocation,
    rowKey,
    getId,
    safeParse
}) => {

    const columns = [
        {
            title: "#",
            dataIndex: "index",
            key: "index",
            render: (_, __, index) => index + 1,
            width: 64,
        },
        {
            title: "Nombre del Lote",
            dataIndex: "name",
            key: "name",
        },
        {
            title: "Área Total (ha)",
            dataIndex: "area",
            key: "area",
        },
        {
            title: "Ubicación",
            dataIndex: "location",
            key: "location",
            render: (loc) => {
                const parsed = safeParse(loc);
                if (!parsed) return "Sin ubicación";
                return (
                    <Button type="link" onClick={() => onViewLocation(parsed)}>
                        Ver
                    </Button>
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
                            onClick={() => onEdit(record)}
                            aria-label="Editar"
                        />
                    </Tooltip>
                    <Popconfirm
                        title="¿Deshabilitar este lote?"
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
            dataSource={lots}
            loading={loading}
            pagination={{ pageSize: 5, position: ['bottomCenter'] }}
            rowKey={rowKey}
        />
    );
};

export default LotTable;
