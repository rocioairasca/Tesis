import { readFile } from 'node:fs/promises';

// Expose a virtual .mjs view of the shared CJS file. Vite development and the
// browser bundler then agree on its module type without copying conversion rules.
export default function inventoryConversionPlugin() {
  return {
    name: 'inventory-conversion-esm',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.replaceAll('\\', '/').endsWith('/shared/inventoryConversion.cjs')) return;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (resolved) return resolved.id + '.mjs';
    },
    async load(id) {
      if (!id.replaceAll('\\', '/').endsWith('/shared/inventoryConversion.cjs.mjs')) return;
      const filename = id.slice(0, -4);
      this.addWatchFile(filename);
      const code = await readFile(filename, 'utf8');
      return {
        code: code.replace("const catalog=require('./inventoryUnits.json');", "import catalog from './inventoryUnits.json';")
          .replace('module.exports=', 'export default '),
        map: null,
      };
    },
  };
}
