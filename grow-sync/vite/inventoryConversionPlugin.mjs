import { readFile } from 'node:fs/promises';

// Shared exact inventory and recipe arithmetic exposed as ESM in Vite development.
export default function inventoryConversionPlugin() {
  const supported = id => /\/shared\/(inventoryConversion|recipeCalculation)\.cjs(?:\.mjs)?$/.test(id.replaceAll('\\', '/'));
  return {
    name: 'inventory-conversion-esm', enforce: 'pre',
    async resolveId(source, importer) {
      if (!/(inventoryConversion|recipeCalculation)\.cjs$/.test(source)) return;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (resolved && supported(resolved.id)) return resolved.id + '.mjs';
    },
    async load(id) {
      if (!id.endsWith('.cjs.mjs') || !supported(id)) return;
      const filename = id.slice(0, -4); this.addWatchFile(filename);
      const code = await readFile(filename, 'utf8');
      return { code: code.replace("const catalog=require('./inventoryUnits.json');", "import catalog from './inventoryUnits.json';")
        .replace("const conversion=require('./inventoryConversion.cjs');", "import conversion from './inventoryConversion.cjs';")
        .replace('module.exports=', 'export default '), map: null };
    },
  };
}