# Media migration manifest

> Applied on 2026-11-09 13:26 IST with `--skip-orphans`: the 6 "ready" files below were migrated
> and verified. The 12 orphans and the invalid file were not copied and remain in `public/uploads`.
> Re-running the inventory now reports the 6 as `already_migrated`.

Generated 2026-11-09T07:13:29.920Z by `node scripts/media-migrate.js inventory --write-doc` (read-only).

Source: `public\uploads` · inventory checksum **ad17cd84ac0e** (pass it to `apply --confirm=`).

| Total files | Total size | Ready | Already migrated | Orphans | Conflicts | Invalid | References to rewrite | Broken references |
|---|---|---|---|---|---|---|---|---|
| 19 | 29.28 MB | 6 | 0 | 12 | 0 | 1 | 9 | 0 |

## Files

| File | Size | Type | SHA-256 (first 16) | Pixels / length | Used by | Target | Status |
|---|---|---|---|---|---|---|---|
| `image_1793716245931_55ed43f12b05ef56.jpg` | 0.16 MB | image/jpeg | `f89fdf310f196d3c` | 1086×1448 | products.image_url, products.images | product-images (public)<br>`products/41a051f9-b8b9-45f6-ad45-ef8ea97b5da3/image_1793716245931_55ed43f12b05ef56.jpg` | ready |
| `image_1793716249372_ea653bf75a842462.jpg` | 0.13 MB | image/jpeg | `03d11137e5e273b1` | 1086×1448 | products.images | product-images (public)<br>`products/41a051f9-b8b9-45f6-ad45-ef8ea97b5da3/image_1793716249372_ea653bf75a842462.jpg` | ready |
| `image_1793716252556_0d4d5153b928a054.jpg` | 0.11 MB | image/jpeg | `a330d5fb53a50e6f` | 1086×1448 | products.images | product-images (public)<br>`products/41a051f9-b8b9-45f6-ad45-ef8ea97b5da3/image_1793716252556_0d4d5153b928a054.jpg` | ready |
| `image_1793716277022_2dbd637705d73a83.jpg` | 0.12 MB | image/jpeg | `db73c909500baf85` | 1086×1448 | products.images | product-images (public)<br>`products/41a051f9-b8b9-45f6-ad45-ef8ea97b5da3/image_1793716277022_2dbd637705d73a83.jpg` | ready |
| `image_1793898865551_062c616140ae9dc0.png` | 0.00 MB | image/png | `c414cd0e204de974` | 1×1 | — | media-archive (private)<br>`legacy/image_1793898865551_062c616140ae9dc0.png` | orphan: No database row uses this file; it is archived privately, not published. |
| `image_1794062915012_22669ee748f08093.png` | 2.18 MB | image/png | `a47a4f07421a9246` | 1774×887 | — | media-archive (private)<br>`legacy/image_1794062915012_22669ee748f08093.png` | orphan: No database row uses this file; it is archived privately, not published. |
| `image_1794063883098_af4dbb272afa8d4f.png` | 2.18 MB | image/png | `a47a4f07421a9246` | 1774×887 | — | media-archive (private)<br>`legacy/image_1794063883098_af4dbb272afa8d4f.png` | orphan: No database row uses this file; it is archived privately, not published. |
| `image_1794064503994_6d7856eccbef0c94.png` | 2.18 MB | image/png | `a47a4f07421a9246` | 1774×887 | — | media-archive (private)<br>`legacy/image_1794064503994_6d7856eccbef0c94.png` | orphan: No database row uses this file; it is archived privately, not published. |
| `image_1794070261889_07b06ff65053a96e.png` | 2.18 MB | image/png | `a47a4f07421a9246` | 1774×887 | homepage_carousel_slides.desktop_image_url, homepage_carousel_slides.published_content | homepage-banners (public)<br>`banners/legacy/image_1794070261889_07b06ff65053a96e.png` | ready |
| `image_1794070399598_f01165ca394a68a9.png` | 1.87 MB | image/png | `bc82a49d52046680` | 1774×887 | homepage_carousel_slides.desktop_image_url, homepage_carousel_slides.published_content | homepage-banners (public)<br>`banners/legacy/image_1794070399598_f01165ca394a68a9.png` | ready |
| `media_1792289934071_o2hemi.mp4` | 8.87 MB | video/mp4 | `591d57ab7b87bcde` | 29.88 s | — | media-archive (private)<br>`legacy/media_1792289934071_o2hemi.mp4` | orphan: No database row uses this file; it is archived privately, not published. |
| `media_1792307826666_bgirs4.mp4` | 8.87 MB | video/mp4 | `591d57ab7b87bcde` | 29.88 s | — | media-archive (private)<br>`legacy/media_1792307826666_bgirs4.mp4` | orphan: No database row uses this file; it is archived privately, not published. |
| `media_1792308304330_9us5q7.mp4` | 0.00 MB | unknown | `176e1354b962e3dc` | — | — | — | invalid: Not a JPG, PNG, WEBP, MP4 or MOV file; left in place. |
| `media_1792312105531_tdrehz.jpg` | 0.06 MB | image/jpeg | `734c65d54d318fad` | 960×1280 | — | media-archive (private)<br>`legacy/media_1792312105531_tdrehz.jpg` | orphan: No database row uses this file; it is archived privately, not published. |
| `media_1792312114912_ub7w2l.jpg` | 0.10 MB | image/jpeg | `9b136685d3c28434` | 1122×1402 | — | media-archive (private)<br>`legacy/media_1792312114912_ub7w2l.jpg` | orphan: No database row uses this file; it is archived privately, not published. |
| `media_1792313810181_lon7he.jpg` | 0.08 MB | image/jpeg | `b63d42c5db8e495d` | 706×909 | — (+1 in audit log) | media-archive (private)<br>`legacy/media_1792313810181_lon7he.jpg` | orphan: No database row uses this file; it is archived privately, not published. |
| `media_1792313822184_h4peow.jpg` | 0.10 MB | image/jpeg | `9b136685d3c28434` | 1122×1402 | — (+1 in audit log) | media-archive (private)<br>`legacy/media_1792313822184_h4peow.jpg` | orphan: No database row uses this file; it is archived privately, not published. |
| `piece_1792249885074_k7kln9.png` | 0.00 MB | image/png | `c414cd0e204de974` | 1×1 | — | media-archive (private)<br>`legacy/piece_1792249885074_k7kln9.png` | orphan: No database row uses this file; it is archived privately, not published. |
| `piece_1792249928453_r9j0zn.jpg` | 0.06 MB | image/jpeg | `734c65d54d318fad` | 960×1280 | — | media-archive (private)<br>`legacy/piece_1792249928453_r9j0zn.jpg` | orphan: No database row uses this file; it is archived privately, not published. |

## Database values pointing at files that are not on disk

None.
