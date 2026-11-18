import type { ReactNode } from 'react';

export interface ProductVariant {
  id: string;
  sku?: string;
  size_label: string;
  price_inr: number;
  sale_price_inr?: number | null;
  effective_price?: number;
  stock_quantity?: number;
  in_stock?: boolean;
}

export interface CatalogueProduct {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  category?: string | null;
  category_slug?: string | null;
  badge?: string | null;
  material?: string | null;
  color?: string | null;
  colour_season?: string | null;
  occasion?: string | null;
  image_url?: string | null;
  images?: string[];
  price_inr?: number | null;
  price_max_inr?: number | null;
  compare_at_price?: number | null;
  available?: boolean;
  sizes?: string[];
  is_one_of_one?: boolean;
  variants?: ProductVariant[];
}

export interface LookPiece {
  id: string;
  name: string;
  role?: string;
  category?: string;
  price_inr?: number | null;
  image_url?: string | null;
  color?: string | null;
  product?: CatalogueProduct;
}

export interface LookItem {
  id: string;
  name: string;
  tagline?: string;
  modelImage: string;
  pieces: LookPiece[];
}

export interface ArcEngineProps<T> {
  items: T[];
  activeIndex: number;
  onChange: (index: number) => void;
  renderItem: (
    item: T,
    index: number,
    meta: {
      d: number;
      absD: number;
      isActive: boolean;
      isSide: boolean;
    }
  ) => ReactNode;
  gap?: number;
  lift?: number;
  rot?: number;
  fade?: number;
  blur?: boolean | number;
  centreScale?: number;
  stageHeight?: number | string;
  className?: string;
  onItemClick?: (item: T, index: number) => void;
  ariaLabel?: string;
}

export interface TryTheLookProps {
  looks?: LookItem[];
  products?: CatalogueProduct[];
  user?: any;
  onAddToBag?: (piece: LookPiece | CatalogueProduct, e?: React.MouseEvent) => void;
  onAddFullLook?: (pieces: LookPiece[], e?: React.MouseEvent) => void;
  onToggleHeart?: (id: string, piece?: LookPiece) => void;
  onSelectPiece?: (piece: LookPiece) => void;
}

export interface CategoryItem {
  slug: string;
  name: string;
  tagline: string;
  cls?: string;
  image?: string;
}

export interface PickAPieceProps {
  categories?: CategoryItem[];
  products?: CatalogueProduct[];
  onAddToBag?: (product: CatalogueProduct, e?: React.MouseEvent) => void;
  onToggleHeart?: (id: string, product?: CatalogueProduct) => void;
  onSelectProduct?: (product: CatalogueProduct) => void;
  onSelectCategory?: (category: CategoryItem) => void;
}

export interface TheRackProps {
  products?: CatalogueProduct[];
  categories?: string[];
  onAddToBag?: (product: CatalogueProduct, variant?: any, e?: React.MouseEvent) => void;
  onToggleHeart?: (id: string, product?: CatalogueProduct) => void;
  onSelectProduct?: (product: CatalogueProduct) => void;
}

export interface FeelTheDrapeProps {
  videoUrl?: string;
  imageUrl?: string;
  lifestylePhotos?: string[];
  onShopCollection?: () => void;
}

export interface ReelItem {
  id: string;
  reelNumber: number;
  title: string;
  location: string;
  categoryTag?: string;
  duration?: string;
  videoUrl?: string;
  thumbnailUrl: string;
  postUrl?: string;
  embedUrl?: string;
  isInstagram?: boolean;
}

export interface StyleInMotionProps {
  reels?: ReelItem[];
  videos?: Array<{
    id: string;
    title?: string;
    customer_name?: string;
    video_url?: string;
    duration_seconds?: number;
  }>;
  instagram?: Array<{
    id: string;
    title?: string;
    post_url?: string;
    image_url?: string;
  }>;
}

export interface OccasionItem {
  id: string;
  name: string;
  occasion: string;
  material?: string | null;
  note?: string | null;
  price_inr?: number | null;
  image_url: string;
  tag?: string | null;
  product?: CatalogueProduct;
}

export interface TheOccasionEditProps {
  items?: OccasionItem[];
  products?: CatalogueProduct[];
  onAddToBag?: (product: CatalogueProduct | OccasionItem, e?: React.MouseEvent) => void;
  onToggleHeart?: (id: string, product?: CatalogueProduct | OccasionItem) => void;
  onSelectProduct?: (product: CatalogueProduct | OccasionItem) => void;
}





