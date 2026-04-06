const router=require('express').Router({ mergeParams:true });
const { listProducts, showNewProduct, createProduct }=require('./product.controller');
router.get('/', listProducts);
router.get('/new', showNewProduct);
router.post('/', createProduct);
module.exports=router;
