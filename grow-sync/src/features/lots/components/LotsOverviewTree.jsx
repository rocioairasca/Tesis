import React, { useEffect, useRef } from 'react';
import { Tree } from 'antd';
import { areaLabel } from '../lotsOverviewModel.mjs';
import { cropText } from './LotOverviewContext';

export default function LotsOverviewTree({ rows, selection, onSelect, expanded, onExpand }) {
  const container = useRef();
  useEffect(() => {
    container.current?.querySelector('.ant-tree-node-selected')?.scrollIntoView({ block: 'nearest' });
  }, [selection?.key, expanded]);
  const node = row => ({ key: row.key, title: <span className={`gs-lots-tree-node${row.enabled ? '' : ' gs-lots-muted'}`}><strong>{row.name}</strong><span>{areaLabel(row.area)} · {cropText(row)}</span>{selection?.key === row.key && <span className="gs-lots-selected-label">Seleccionado</span>}{!row.enabled && <span>Deshabilitado</span>}</span>, children: row.children?.map(node) });
  return <nav ref={container} className="gs-lots-tree" aria-label="Lotes y divisiones"><h2>Lotes y divisiones</h2><Tree blockNode virtual={false} treeData={rows.map(node)} selectedKeys={selection ? [selection.key] : []} expandedKeys={expanded} onExpand={onExpand} onSelect={(_, info) => onSelect(info.node.key)} /></nav>;
}
