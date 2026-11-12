-- Development / QA demo catalogue. Never run against production.
INSERT INTO products(category_id,name,slug,description,price_inr,is_one_of_one,is_active,badge,material,color,featured,size_label)
SELECT c.id,x.name,x.slug,x.description,x.price,x.one_of_one,true,x.badge,x.material,x.color,x.featured,x.size_label
FROM categories c JOIN (VALUES
  ('Tops','Sculpted Everyday Top','sculpted-everyday-top','A clean, structured top with an easy everyday silhouette.',1890,true,'NEW','Soft structured fabric','Ivory',true,'S / M'),
  ('Dresses','The Wine Slip Dress','the-wine-slip-dress','A fluid evening silhouette in Vishrea wine.',3490,true,'EDITORIAL','Fluid satin blend','Wine',true,'M'),
  ('Coord Sets','Soft Structure Coord','soft-structure-coord','A considered matching set made for effortless dressing.',4290,true,'NEW','Textured crepe','Stone',true,'Free Size'),
  ('Pants','Tailored Wide-Leg Pant','tailored-wide-leg-pant','A relaxed wide-leg trouser with a tailored finish.',2790,true,NULL,'Tailored twill','Black',false,'M / L'),
  ('Party Dresses','After Hours Dress','after-hours-dress','A refined party silhouette for after-dark plans.',3990,true,'LIMITED','Satin blend','Burgundy',true,'S'),
  ('Cardigans','Relaxed Knit Cardigan','relaxed-knit-cardigan','Soft knit layering with a clean contemporary line.',2490,true,NULL,'Fine knit','Oat',false,'Free Size'),
  ('Dresses','Premium Silk Column Dress','premium-silk-column-dress','A bias-cut silk column, cut to order in four sizes.',5200,false,'PREMIUM','Mulberry silk','Ink',true,NULL)
) x(cat,name,slug,description,price,one_of_one,badge,material,color,featured,size_label) ON c.name=x.cat
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.slug=x.slug);

INSERT INTO inventory(product_id,status) SELECT p.id,'available' FROM products p
WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.product_id=p.id);

-- One default variant per one-of-one piece
INSERT INTO product_variants (product_id, sku, size_label, price_inr, stock_quantity)
SELECT p.id, 'VS-' || upper(substr(replace(p.id::text,'-',''),1,12)), COALESCE(p.size_label,'Free Size'), p.price_inr, 1
FROM products p WHERE p.is_one_of_one AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id);

-- Size-specific pricing example
INSERT INTO product_variants (product_id, sku, size_label, price_inr, sale_price_inr, stock_quantity, sort_order)
SELECT p.id, x.sku, x.size, x.price, x.sale, x.stock, x.ord
FROM products p, (VALUES
  ('PSCD-S','Small',5200,NULL::numeric,1,1),
  ('PSCD-M','Medium',5400,NULL,3,2),
  ('PSCD-L','Large',5600,5200,2,3),
  ('PSCD-XXL','Double XL',6100,NULL,1,4)
) x(sku,size,price,sale,stock,ord)
WHERE p.slug='premium-silk-column-dress'
  AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id);
