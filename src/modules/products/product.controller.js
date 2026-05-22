const { Product } = require('./product.model');
const { ModuleDefinition } = require('../modules/module.model');

async function listProducts(req,res,next){
 try{ const [items, modules]=await Promise.all([Product.find({ tenantId:req.tenant._id }).sort({ isActive:-1, name:1 }).lean(), ModuleDefinition.find({ tenantId:req.tenant._id }).sort({ isActive:-1, name:1 }).lean()]);
 if(req.originalUrl.startsWith('/api/')) return res.json({ items });
 return res.render('products/index',{ title:'Products & Modules', items, modules }); }catch(e){ return next(e); } }
async function showNewProduct(req,res,next){ try{ return res.render('products/new',{ title:'New Product', defaults:{ code:'', name:'', description:'', isActive:true } }); }catch(e){ return next(e);} }
async function createProduct(req,res,next){ try{ const body=req.body||{}; await Product.create({ tenantId:req.tenant._id, code:String(body.code||'').trim().toUpperCase(), name:String(body.name||'').trim(), description:String(body.description||'').trim(), isActive: body.isActive==='true'||body.isActive==='on'||body.isActive===true }); req.session.success='Product created successfully.'; return res.redirect(`${req.basePath}/admin/products`);}catch(e){ if(e.code===11000){ req.session.error='Product code already exists.'; return res.redirect(`${req.basePath}/admin/products/new`);} return next(e);} }



async function showEditProduct(req,res,next){
 try{ const item=await Product.findOne({ _id:req.params.id, tenantId:req.tenant._id }).lean();
 if(!item){ req.session.error='Product not found.'; return res.redirect(`${req.basePath}/admin/products`); }
 return res.render('products/new',{ title:`Edit ${item.name}`, defaults:item, item, formAction:`${req.basePath}/admin/products/${item._id}/edit`, submitLabel:'Save Product' });
 }catch(e){ return next(e);} }
async function updateProduct(req,res,next){
 try{ const body=req.body||{};
 const item=await Product.findOneAndUpdate({ _id:req.params.id, tenantId:req.tenant._id },{ $set:{ code:String(body.code||'').trim().toUpperCase(), name:String(body.name||'').trim(), description:String(body.description||'').trim(), isActive: body.isActive==='true'||body.isActive==='on'||body.isActive===true } },{ new:true });
 if(!item){ req.session.error='Product not found.'; return res.redirect(`${req.basePath}/admin/products`); }
 req.session.success='Product updated successfully.'; return res.redirect(`${req.basePath}/admin/products`);
 }catch(e){ if(e.code===11000){ req.session.error='Product code already exists.'; return res.redirect(`${req.basePath}/admin/products/${req.params.id}/edit`);} return next(e);} }
async function toggleProductStatus(req,res,next){
 try{ const item=await Product.findOneAndUpdate({ _id:req.params.id, tenantId:req.tenant._id },{ $set:{ isActive: String(req.body.isActive)==='true' } },{ new:true });
 if(!item){ req.session.error='Product not found.'; return res.redirect(`${req.basePath}/admin/products`); }
 req.session.success=item.isActive?'Product activated.':'Product deactivated.'; return res.redirect(`${req.basePath}/admin/products`);
 }catch(e){ return next(e);} }
module.exports={ listProducts, showNewProduct, createProduct, showEditProduct, updateProduct, toggleProductStatus };
