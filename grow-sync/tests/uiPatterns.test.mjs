import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

test('patrones compartidos: semántica, callbacks, mobile, paginación y errores',async()=>{
  const {createServer}=await import('vite');
  const React=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
  const {Context}=await import('react-responsive');
  const {MemoryRouter}=await import('react-router-dom');
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
  try{
    const ui=await server.ssrLoadModule('/src/components/ui/index.js');
    const render=(Component,props,width=1280)=>renderToStaticMarkup(React.createElement(Context.Provider,{value:{width}},React.createElement(MemoryRouter,null,React.createElement(Component,props))));
    const header={title:'Colección de prueba',description:'Descripción configurable',primaryAction:{label:'Crear',onClick:()=>{}},secondaryActions:[{key:'one',label:'Exportar',onClick:()=>{}},{key:'two',label:'Importar',onClick:()=>{}}]};
    assert.ok(render(ui.PageHeader,header).includes('Exportar'));
    const mobileHeader=render(ui.PageHeader,header,390);assert.ok(mobileHeader.includes('Crear'));assert.ok(mobileHeader.includes('Más acciones de la página'));assert.ok(!mobileHeader.includes('Exportar'));
    assert.ok(render(ui.StatusBadge,{tone:'warning',children:'Pendiente'}).includes('Pendiente'));
    assert.ok(!render(ui.CategoryTag,{children:'Clasificación'}).includes('gs-ui-status'));
    let clicks=0;const metric=ui.Metric({label:'Ejemplos',value:0,onClick:()=>clicks++});metric.props.onClick();assert.equal(clicks,1);assert.equal(metric.type,'button');
    assert.ok(render(ui.Metric,{label:'Ejemplos',value:0}).includes('>0<'));
    assert.ok(render(ui.EntityLink,{disabled:true,children:'Entidad',to:'/existing'}).includes('aria-disabled="true"'));
    assert.ok(!render(ui.EntityLink,{disabled:true,children:'Entidad',to:'/existing'}).includes('href='));
    assert.ok(render(ui.EntityLink,{children:'Entidad',to:'/existing'}).includes('href="/existing"'));
    assert.ok(!render(ui.ErrorState,{error:new Error('SQL constraint private_table')}).includes('private_table'));
    assert.ok(render(ui.LoadingState,{label:'Cargando colección'}).includes('role="status"'));
    assert.ok(render(ui.EmptyState,{title:'No hay elementos en esta colección'}).includes('No hay elementos en esta colección'));
    const filter={search:{value:'hola',onChange:()=>{}},filters:React.createElement('select',{'aria-label':'Categoría'}),activeFilters:[{key:'a',label:'Filtro A'}],onClear:()=>{}};
    assert.ok(render(ui.FilterBar,filter,390).includes('Filtros (1)'));assert.ok(render(ui.FilterBar,filter).includes('Limpiar filtros'));
    assert.ok(!render(ui.ViewSwitcher,{options:['Tabla','Calendario'],value:'Tabla',onChange:()=>{}}).includes('role="tab"'));
    const data=Array.from({length:12},(_,i)=>({id:i+1,name:`Fila-${i+1}-fin`}));
    const props={title:'Ejemplos',columns:[{title:'Nombre',dataIndex:'name'}],dataSource:data,rowLabel:r=>r.name,pagination:{current:2,pageSize:5}};
    for(const width of [1280,390]){
      const table=render(ui.DataTable,props,width);assert.ok(table.includes('Fila-6-fin'));assert.ok(!table.includes('Fila-1-fin'));assert.ok(!table.includes('Fila-11-fin'));
      assert.equal(table.includes('<table'),width===1280);
      const remote=render(ui.DataTable,{...props,dataSource:data.slice(5,10),paginationMode:'server',pagination:{current:2,pageSize:5,total:12}},width);assert.ok(remote.includes('Fila-6-fin'));
      const empty=render(ui.DataTable,{...props,dataSource:[],empty:{title:'Ningún resultado coincide'}},width);assert.ok(empty.includes('Ningún resultado coincide'));
    }
    assert.equal(ui.RowActions({label:'Acciones',actions:[{key:'hidden',label:'No visible',hidden:true}]}),null);
    const menu=ui.RowActions({label:'Acciones',actions:[{key:'a',label:'Editar'},{key:'b',label:'Deshabilitar',danger:true}]});assert.equal(menu.props.menu.items[1].type,'divider');
  }finally{await server.close();}
});
