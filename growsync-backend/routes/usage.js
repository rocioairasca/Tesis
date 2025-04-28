const express = require('express');
const router = express.Router();
const {
  listUsages,
  createUsage,
  editUsage,
  disableUsage,
  listDisabledUsages,
  enableUsage
} = require('../controllers/usage/usage');

// Rutas
router.get('/', listUsages);
router.post('/', createUsage);
router.put('/:id', editUsage);
router.delete('/:id', disableUsage);
router.get('/disabled', listDisabledUsages);
router.put('/enable/:id', enableUsage);

module.exports = router;
