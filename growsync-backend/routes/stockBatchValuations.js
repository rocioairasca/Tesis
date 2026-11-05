const express = require('express');
const checkRole = require('../middleware/checkRole');
const requirePermission = require('../middleware/requirePermission');
const { PERMISSIONS } = require('../constants/permissions');
module.exports = pool => {
  const router=express.Router({mergeParams:true});
  const controller=require('../controllers/products/stockBatchValuations')(pool);
  router.get('/',checkRole(0),requirePermission(PERMISSIONS.INVENTORY_VIEW),controller.current);
  router.get('/history',checkRole(0),requirePermission(PERMISSIONS.INVENTORY_VIEW),controller.history);
  router.post('/',checkRole(2),requirePermission(PERMISSIONS.INVENTORY_EDIT),controller.create);
  return router;
};
