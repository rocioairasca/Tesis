// IMPORTACION DEL CLIENTE SUPABASE
const supabase = require('../../db/supabaseClient'); 

// LISTAR PRODUCTOS DESHABILITADOS - Obtiene todos los productos deshabilitados, ordenados por ID
const listDisabledProducts = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('enabled', false)
            .order('id', { ascending: true });

        if (error) {
            console.error("Error al listar productos deshabilitados:", error);
            return res.status(500).json({ message: 'Error al listar productos deshabilitados', error });
        }

        res.json(data);
    } catch (error) {
        console.error("Error inesperado al listar productos deshabilitados:", error);
        res.status(500).json({ message: 'Error al listar productos deshabilitados', error });
    }
};

// HABILITAR PRODUCTOS - Cambia "enabled" a TRUE para un producto específico
const enableProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('products')
            .update({ enabled: true })
            .eq('id', id);

        if (error) {
            console.error("Error al habilitar producto:", error);
            return res.status(500).json({ message: 'Error al habilitar producto', error });
        }

        res.status(200).json({ message: 'Producto habilitado exitosamente.' });
    } catch (error) {
        console.error("Error inesperado al habilitar producto:", error);
        res.status(500).json({ message: 'Error al habilitar producto', error });
    }
};

// EXPORTAMOS LAS FUNCIONES PARA SER USADAS EN UNA RUTA (routes/products.js)
module.exports = {
    listDisabledProducts, 
    enableProduct
};
