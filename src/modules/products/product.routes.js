const router=require('express').Router({ mergeParams:true });
const { listProducts, showNewProduct, createProduct, showEditProduct, updateProduct, toggleProductStatus }=require('./product.controller');
router.get('/', listProducts);
router.get('/new', showNewProduct);
router.post('/', createProduct);
router.get('/:id/edit', showEditProduct);
router.post('/:id/edit', updateProduct);
router.post('/:id/status', toggleProductStatus);
module.exports=router;
