const { Product } = require('./product.model');

async function listProducts(req,res,next){
 try{ const items=await Product.find({ tenantId:req.tenant._id }).sort({ isActive:-1, name:1 }).lean();
 if(req.originalUrl.startsWith('/api/')) return res.json({ items });
 return res.render('products/index',{ title:'Products', items }); }catch(e){ return next(e); } }
async function showNewProduct(req,res,next){ try{ return res.render('products/new',{ title:'New Product', defaults:{ code:'', name:'', description:'', isActive:true } }); }catch(e){ return next(e);} }
async function createProduct(req,res,next){ try{ const body=req.body||{}; await Product.create({ tenantId:req.tenant._id, code:String(body.code||'').trim().toUpperCase(), name:String(body.name||'').trim(), description:String(body.description||'').trim(), isActive: body.isActive==='true'||body.isActive==='on'||body.isActive===true }); req.session.success='Product created successfully.'; return res.redirect(`${req.basePath}/admin/products`);}catch(e){ if(e.code===11000){ req.session.error='Product code already exists.'; return res.redirect(`${req.basePath}/admin/products/new`);} return next(e);} }
module.exports={ listProducts, showNewProduct, createProduct };
