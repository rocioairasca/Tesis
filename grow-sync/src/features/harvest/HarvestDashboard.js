import { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Select, Spin, Empty } from 'antd';
import { Column, Line } from '@ant-design/plots';

import {
    getHarvestFilters,
    getHarvestSummary,
    getHarvestByCrop,
    getHarvestByCampaign,
} from '../../services/harvestService';

import { 
    convertYield, 
    formatUnitLabel,
    formatCropLabel,
    formatNumber
} from '../../utils/yieldUtils';

const { Option } = Select;

const HarvestDashboard = () => {
    const [filters, setFilters] = useState({
        campaign: null,
        crop: null
    });

    const [unit, setUnit] = useState('kg');

    const [data, setData] = useState({
        summary: null,
        byCrop: [],
        byCampaign: [],
        filters: { campaigns: [], crops: [] }
    });

    const [loading, setLoading] = useState(false);

    const fetchData = async () => {
        setLoading(true);

        try {
            const params = {
                campaign: filters.campaign,
                crop: filters.crop
            };

            const [filtersRes, summaryRes, cropRes, campaignRes] =
                await Promise.all([
                    getHarvestFilters(),
                    getHarvestSummary(params),
                    getHarvestByCrop({ camapign: filters.campaign }),
                    getHarvestByCampaign({ crop: filters.crop })
                ]);
            
            setData({
                filters: filtersRes,
                summary: summaryRes,
                byCrop: cropRes,
                byCampaign: campaignRes
            });
        } catch (err) {
            console.error('Error dashboard cosecha:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [filters]);

    const byCropChartData = useMemo(() => {
        return (data.byCrop || []).map((item) => ({
        crop: formatCropLabel(item.crop),
        yield: convertYield(item.yield_kg_ha, unit),
        production_kg: Number(item.production_kg || 0),
        area_ha: Number(item.area_ha || 0)
        }));
    }, [data.byCrop, unit]);

    const byCampaignChartData = useMemo(() => {
        return (data.byCampaign || []).map((item) => ({
        campaign: item.campaign,
        yield: convertYield(item.yield_kg_ha, unit),
        production_kg: Number(item.production_kg || 0),
        area_ha: Number(item.area_ha || 0)
        }));
    }, [data.byCampaign, unit]);

    const byCropConfig = {
        data: byCropChartData,
        xField: 'crop',
        yField: 'yield',
        height: 320,
        label: {
        position: 'top',
        text: (datum) => `${formatNumber(datum.yield)} ${formatUnitLabel(unit)}`
        },
        tooltip: {
        title: (datum) => datum.crop,
        items: [
            (datum) => ({
            name: 'Rendimiento',
            value: `${formatNumber(datum.yield)} ${formatUnitLabel(unit)}`
            }),
            (datum) => ({
            name: 'Producción',
            value: `${formatNumber(datum.production_kg, 0)} kg`
            }),
            (datum) => ({
            name: 'Superficie',
            value: `${formatNumber(datum.area_ha)} ha`
            })
        ]
        },
        axis: {
        y: {
            title: formatUnitLabel(unit)
        },
        x: {
            title: 'Cultivo'
        }
        }
    };

    const byCampaignConfig = {
        data: byCampaignChartData,
        xField: 'campaign',
        yField: 'yield',
        height: 320,
        point: {
        size: 4,
        shape: 'circle'
        },
        label: {
        text: (datum) => `${formatNumber(datum.yield)}`
        },
        tooltip: {
        title: (datum) => datum.campaign,
        items: [
            (datum) => ({
            name: 'Rendimiento',
            value: `${formatNumber(datum.yield)} ${formatUnitLabel(unit)}`
            }),
            (datum) => ({
            name: 'Producción',
            value: `${formatNumber(datum.production_kg, 0)} kg`
            }),
            (datum) => ({
            name: 'Superficie',
            value: `${formatNumber(datum.area_ha)} ha`
            })
        ]
        },
        axis: {
        y: {
            title: formatUnitLabel(unit)
        },
        x: {
            title: 'Campaña'
        }
        },
        smooth: true
    };

    return (
        <div>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={12} md={8} lg={6}>
                    <Select
                        placeholder="Campaña"
                        allowClear
                        style={{ width: '100%' }}
                        value={filters.campaign}
                        onChange={(value) =>
                        setFilters((prev) => ({ ...prev, campaign: value || null }))
                        }
                    >
                        {data.filters.campaigns.map((campaign) => (
                        <Option key={campaign} value={campaign}>
                            {campaign}
                        </Option>
                        ))}
                    </Select>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6}>
                    <Select
                        placeholder="Cultivo"
                        allowClear
                        style={{ width: '100%' }}
                        value={filters.crop}
                        onChange={(value) =>
                        setFilters((prev) => ({ ...prev, crop: value || null }))
                        }
                    >
                        {data.filters.crops.map((crop) => (
                        <Option key={crop} value={crop}>
                            {formatCropLabel(crop)}
                        </Option>
                        ))}
                    </Select>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6}>
                    <Select
                        value={unit}
                        style={{ width: '100%' }}
                        onChange={setUnit}
                    >
                        <Option value="kg">kg/ha</Option>
                        <Option value="qq">qq/ha</Option>
                        <Option value="tn">tn/ha</Option>
                    </Select>
                </Col>
            </Row>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                    <Spin size="large" />
                </div>
            ) : (
                <>
                    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                        <Col xs={24} sm={12} lg={6}>
                        <Card title="Producción total">
                            {formatNumber(data.summary?.total_production_kg, 0)} kg
                        </Card>
                        </Col>

                        <Col xs={24} sm={12} lg={6}>
                        <Card title="Superficie cosechada">
                            {formatNumber(data.summary?.total_area_ha)} ha
                        </Card>
                        </Col>

                        <Col xs={24} sm={12} lg={6}>
                        <Card title="Rendimiento promedio">
                            {formatNumber(convertYield(data.summary?.avg_yield_kg_ha, unit))}{' '}
                            {formatUnitLabel(unit)}
                        </Card>
                        </Col>

                        <Col xs={24} sm={12} lg={6}>
                        <Card title="Registros">
                            {formatNumber(data.summary?.total_records, 0)}
                        </Card>
                        </Col>
                    </Row>

                    <Row gutter={[16, 16]}>
                        <Col xs={24} lg={12}>
                        <Card title="Rendimiento por cultivo">
                            {byCropChartData.length > 0 ? (
                            <Column {...byCropConfig} />
                            ) : (
                            <Empty description="No hay datos para mostrar" />
                            )}
                        </Card>
                        </Col>

                        <Col xs={24} lg={12}>
                        <Card title="Evolución por campaña">
                            {byCampaignChartData.length > 0 ? (
                            <Line {...byCampaignConfig} />
                            ) : (
                            <Empty description="No hay datos para mostrar" />
                            )}
                        </Card>
                        </Col>
                    </Row>
                </>
            )}
        </div>
    );
};

export default HarvestDashboard;