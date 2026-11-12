import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { PAGES, PRIVATE_PATHS } from './pages';
import { SITE, absoluteUrl } from '../site.config.js';
import { breadcrumbSchema, graph, jsonLdString, productSchema, webPageSchema } from './schema';
import { productMetaDescription } from './productCopy';

function setMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!content) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * Keeps <head> in sync with the current view. The server renders the same tags on first load
 * (see lib/seo.js), so crawlers that do not run JavaScript get identical metadata.
 */
export function usePageSeo({ title, description, canonical, ogImage, noIndex = false, breadcrumbs = null, product = null, schema = null, ready = true } = {}) {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!ready) return;
    const reg = Object.values(PAGES).find((p) => p.path === pathname);
    const isPrivate = PRIVATE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    const finalTitle = title || reg?.title || SITE.name;
    const finalDesc = description || (product ? productMetaDescription(product) : null) || reg?.description || SITE.description;
    const url = absoluteUrl(canonical || pathname);
    const image = absoluteUrl(ogImage || product?.image_url || reg?.ogImage || SITE.defaultImage);
    const indexable = !noIndex && !isPrivate && (reg ? reg.indexable : true);

    document.title = finalTitle;
    setMeta('name', 'description', finalDesc);
    setMeta('name', 'robots', indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow');
    setMeta('property', 'og:title', finalTitle);
    setMeta('property', 'og:description', finalDesc);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:type', product ? 'product' : 'website');
    setMeta('property', 'og:image', image);
    setMeta('property', 'og:site_name', SITE.name);
    setMeta('property', 'og:locale', SITE.locale);
    setMeta('property', 'product:price:amount', product?.price_inr != null ? String(product.price_inr) : null);
    setMeta('property', 'product:price:currency', product?.price_inr != null ? 'INR' : null);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', finalTitle);
    setMeta('name', 'twitter:description', finalDesc);
    setMeta('name', 'twitter:image', image);
    setLink('canonical', url);

    let script = document.getElementById('json-ld-seo');
    if (!indexable) {
      script?.remove();
      return;
    }
    const nodes = [webPageSchema({ url, title: finalTitle, description: finalDesc, type: product ? 'ItemPage' : 'WebPage' }), breadcrumbSchema(url, breadcrumbs), productSchema(product, url), ...(Array.isArray(schema) ? schema : schema ? [schema] : [])];
    if (!script) {
      script = document.createElement('script');
      script.id = 'json-ld-seo';
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }
    script.textContent = jsonLdString(graph(nodes));
  }, [pathname, title, description, canonical, ogImage, noIndex, breadcrumbs, product, schema, ready]);
}
