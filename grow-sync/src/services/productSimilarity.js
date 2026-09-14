import api from './apiClient';
import { similarProducts } from '../features/inventory/inventoryModel.mjs';

// Reuse tenant-scoped listing. Compare locally to support symmetric containment
// and repeated whitespace; a raw ilike(name) query would miss those matches.
export async function findSimilarProducts(name,includeDisabled,signal){
  const products=[];
  for(let page=1;;page++){
    const {data}=await api.get('/products',{params:{page,pageSize:1000,...(includeDisabled?{includeDisabled:true}:{})},signal});
    products.push(...data.data);
    if(products.length>=data.total||!data.data.length)break;
  }
  return similarProducts(products,name);
}
