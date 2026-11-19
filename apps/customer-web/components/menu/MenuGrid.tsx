'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { MenuItem, ComboOffer } from '../../types';
import { SquareItemCard } from './SquareItemCard';
import { MenuItemRowCard } from './MenuItemRowCard';
import { CategoryFilterBar } from './CategoryFilterBar';
import { DEFAULT_CATEGORIES } from './menu-constants';

export { DEFAULT_CATEGORIES };

// ============================================================================
// Types
// ============================================================================

export type MenuSortOption = 'POPULAR' | 'PRICE_ASC' | 'PRICE_DESC' | 'RATING' | 'PREP_TIME';
export type MenuDietaryFilter = 'ALL' | 'VEG' | 'NON_VEG';
export type MenuViewMode = 'row' | 'grid';

export interface MenuFilterOptions {
  filterNorthIndian?: boolean;
  filterSouthIndian?: boolean;
  filterHealthy?: boolean;
  filterAvailableOnly?: boolean;
}

export interface MenuGridProps {
  menuItems: MenuItem[];
  categories?: readonly string[];
  combos?: ComboOffer[];
  onSelectItem: (item: MenuItem) => void;
  onQuickAdd?: (item: MenuItem, e: React.MouseEvent) => void;
  onQuickDecrement?: (itemId: string, e: React.MouseEvent) => void;
  activeCategory?: string;
  onCategoryChange?: (category: string) => void;
  wishlist?: Set<string>;
  onToggleWishlist?: (itemId: string, e: React.MouseEvent) => void;
  filterOptions?: MenuFilterOptions;
  initialSearchQuery?: string;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  dietaryFilter?: MenuDietaryFilter;
  onDietaryFilterChange?: (filter: MenuDietaryFilter) => void;
  sortOption?: MenuSortOption;
  onSortOptionChange?: (sort: MenuSortOption) => void;
  defaultViewMode?: MenuViewMode;
  showViewToggle?: boolean;
}

// ============================================================================
// Component Implementation
// ============================================================================

export function MenuGrid({
  menuItems,
  categories = DEFAULT_CATEGORIES,
  combos = [],
  onSelectItem,
  onQuickAdd,
  onQuickDecrement,
  activeCategory: propActiveCategory,
  onCategoryChange,
  wishlist,
  onToggleWishlist,
  filterOptions,
  initialSearchQuery = '',
  searchQuery: propSearchQuery,
  onSearchChange,
  dietaryFilter: propDietaryFilter,
  onDietaryFilterChange,
  sortOption: propSortOption,
  onSortOptionChange,
  defaultViewMode = 'row',
  showViewToggle = true,
}: MenuGridProps) {
  // ── Search & Filter State ──
  const [internalSearchQuery, setInternalSearchQuery] = useState(initialSearchQuery);
  const searchQuery = propSearchQuery !== undefined ? propSearchQuery : internalSearchQuery;

  const [internalDietaryFilter, setInternalDietaryFilter] = useState<MenuDietaryFilter>('ALL');
  const dietaryFilter = propDietaryFilter !== undefined ? propDietaryFilter : internalDietaryFilter;

  const handleDietaryFilterChange = (filter: MenuDietaryFilter) => {
    setInternalDietaryFilter(filter);
    onDietaryFilterChange?.(filter);
  };

  const [internalSortOption, setInternalSortOption] = useState<MenuSortOption>('POPULAR');
  const sortOption = propSortOption !== undefined ? propSortOption : internalSortOption;

  const handleSortOptionChange = (sort: MenuSortOption) => {
    setInternalSortOption(sort);
    onSortOptionChange?.(sort);
  };

  const [viewMode, setViewMode] = useState<MenuViewMode>(defaultViewMode);

  // ── Category Navigation State ──
  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      if (a.toLowerCase() === 'combos') return -1;
      if (b.toLowerCase() === 'combos') return 1;
      return 0;
    });
  }, [categories]);

  const [internalActiveCategory, setInternalActiveCategory] = useState<string>(
    sortedCategories[0] || 'Combos'
  );
  const activeCategory =
    propActiveCategory !== undefined ? propActiveCategory : internalActiveCategory;

  const handleCategorySelect = (cat: string) => {
    setInternalActiveCategory(cat);
    onCategoryChange?.(cat);
    scrollToCategory(cat);
  };

  const handleSearchInput = (val: string) => {
    setInternalSearchQuery(val);
    onSearchChange?.(val);
  };

  // ── Scroll-Spy & Smooth Navigation Ref Lock ──
  const isManualScrollRef = useRef(false);
  const manualScrollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToCategory = (cat: string) => {
    const pillEl = document.getElementById(`pill-${cat}`);
    if (pillEl) {
      pillEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    const el = document.getElementById(`cat-section-${cat}`);
    if (el) {
      isManualScrollRef.current = true;
      if (manualScrollTimerRef.current) clearTimeout(manualScrollTimerRef.current);
      manualScrollTimerRef.current = setTimeout(() => {
        isManualScrollRef.current = false;
      }, 700);
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Scroll to active category when controlled prop changes
  useEffect(() => {
    if (propActiveCategory && propActiveCategory !== internalActiveCategory) {
      setInternalActiveCategory(propActiveCategory);
      scrollToCategory(propActiveCategory);
    }
  }, [propActiveCategory]);

  // ── Filtered & Sorted Menu Items ──
  const filteredItems = useMemo(() => {
    return menuItems
      .filter((item) => {
        // Dietary chip filter
        if (dietaryFilter === 'VEG' && item.dietaryTag !== 'VEG') return false;
        if (dietaryFilter === 'NON_VEG' && item.dietaryTag !== 'NON_VEG') return false;

        // External filter options (funnel)
        if (filterOptions) {
          const { filterNorthIndian, filterSouthIndian, filterHealthy, filterAvailableOnly } =
            filterOptions;
          if (filterNorthIndian && !filterSouthIndian && item.cuisine !== 'NORTH_INDIAN')
            return false;
          if (filterSouthIndian && !filterNorthIndian && item.cuisine !== 'SOUTH_INDIAN')
            return false;
          if (filterHealthy && !item.isHealthy) return false;
          if (filterAvailableOnly && !item.isAvailable) return false;
        }

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            item.name.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.category.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (sortOption === 'PRICE_ASC') return a.pricePaise - b.pricePaise;
        if (sortOption === 'PRICE_DESC') return b.pricePaise - a.pricePaise;
        if (sortOption === 'RATING') return b.rating - a.rating;
        if (sortOption === 'PREP_TIME') return a.prepTimeMinutes - b.prepTimeMinutes;
        return b.ordersCount - a.ordersCount; // Default: Popular
      });
  }, [menuItems, dietaryFilter, filterOptions, searchQuery, sortOption]);

  // Group items by category
  const groupedItems = useMemo(() => {
    const groups: Record<string, MenuItem[]> = {};
    categories.forEach((cat) => {
      groups[cat] = [];
    });
    filteredItems.forEach((item) => {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category]!.push(item);
    });
    return groups;
  }, [filteredItems, categories]);

  // ── Scroll-Spy Effect ──
  useEffect(() => {
    const handleScroll = () => {
      if (isManualScrollRef.current) return;

      // 1. Bottom of page check
      const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
      const scrollBottom = window.innerHeight + window.scrollY;
      const isNearBottom = scrollHeight - scrollBottom <= 80;

      if (isNearBottom) {
        const availableCats = categories.filter((c) => (groupedItems[c] || []).length > 0);
        if (availableCats.length > 0) {
          const lastCat = availableCats[availableCats.length - 1];
          if (lastCat && lastCat !== activeCategory) {
            setInternalActiveCategory(lastCat);
            onCategoryChange?.(lastCat);
            const pillEl = document.getElementById(`pill-${lastCat}`);
            if (pillEl) {
              pillEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
            return;
          }
        }
      }

      // 2. Viewport midpoint check
      const viewportMid = window.innerHeight * 0.5;
      let candidateCat: string | null = null;

      for (const cat of categories) {
        const el = document.getElementById(`cat-section-${cat}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= viewportMid && rect.bottom > 120) {
            candidateCat = cat;
          }
        }
      }

      if (candidateCat && candidateCat !== activeCategory) {
        const chosen = candidateCat;
        setInternalActiveCategory(chosen);
        onCategoryChange?.(chosen);
        const pillEl = document.getElementById(`pill-${chosen}`);
        if (pillEl) {
          pillEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [categories, groupedItems, activeCategory, onCategoryChange]);

  const hasAnyItems = filteredItems.length > 0;

  return (
    <div className="menu-grid-container">
      {/* 1. Live Search Bar */}
      <div className="menu-search-container">
        <div className="menu-search-input-wrap">
          <span className="menu-search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search dishes, curries, tandoor, desserts..."
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="menu-search-input"
          />
          {searchQuery && (
            <button
              type="button"
              className="menu-search-clear"
              onClick={() => handleSearchInput('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 2 & 3. Sticky Combined Toolbar: Category Pills + Secondary Filter Row */}
      <div className="menu-sticky-toolbar-wrapper">
        <CategoryFilterBar
          categories={sortedCategories}
          activeCategory={activeCategory}
          onSelectCategory={handleCategorySelect}
        />

        {/* 3. Filter Chips & Sort Row */}
        <div className="menu-filter-sort-row">
          <div className="dietary-chips-group">
            <button
              type="button"
              className={`dietary-chip-btn ${dietaryFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => handleDietaryFilterChange('ALL')}
            >
              All
            </button>
            <button
              type="button"
              className={`dietary-chip-btn ${dietaryFilter === 'VEG' ? 'active' : ''}`}
              onClick={() => handleDietaryFilterChange(dietaryFilter === 'VEG' ? 'ALL' : 'VEG')}
            >
              <span style={{ color: '#10b981' }}>🟢</span> Veg
            </button>
            <button
              type="button"
              className={`dietary-chip-btn ${dietaryFilter === 'NON_VEG' ? 'active' : ''}`}
              onClick={() => handleDietaryFilterChange(dietaryFilter === 'NON_VEG' ? 'ALL' : 'NON_VEG')}
            >
              <span style={{ color: '#ef4444' }}>🔴</span> Non-Veg
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {showViewToggle && (
              <button
                type="button"
                onClick={() => setViewMode((prev) => (prev === 'row' ? 'grid' : 'row'))}
                className="dietary-chip-btn"
                style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                title={viewMode === 'row' ? 'Switch to Card Grid' : 'Switch to List Rows'}
              >
                {viewMode === 'row' ? '⊞ Grid' : '☰ Rows'}
              </button>
            )}

            <select
              className="sort-select-dropdown"
              value={sortOption}
              onChange={(e) => handleSortOptionChange(e.target.value as MenuSortOption)}
            >
              <option value="POPULAR">Sort: Popular</option>
              <option value="PRICE_ASC">Price: Low to High</option>
              <option value="PRICE_DESC">Price: High to Low</option>
              <option value="RATING">Rating: High to Low</option>
              <option value="PREP_TIME">Prep Time</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. Menu Category Sections */}
      <div style={{ paddingBottom: '30px' }}>
        {hasAnyItems ? (
          sortedCategories.map((cat) => {
            const itemsInCat = groupedItems[cat] || [];
            if (itemsInCat.length === 0) return null;

            return (
              <section key={cat} id={`cat-section-${cat}`} className="menu-category-section">
                <h3 className="menu-category-header">
                  {cat === 'Combos' ? '🔥 Combos & Feasts (10% OFF Bundles)' : cat}
                </h3>

                {viewMode === 'grid' ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '12px',
                      padding: '8px 0',
                    }}
                  >
                    {itemsInCat.map((item) => (
                      <SquareItemCard
                        key={item.id}
                        item={item}
                        isHearted={wishlist ? wishlist.has(item.id) : undefined}
                        onToggleHeart={(e) => onToggleWishlist?.(item.id, e)}
                        onOpenAccordion={() => onSelectItem(item)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="menu-items-list">
                    {itemsInCat.map((item) => {
                      const matchingCombo = combos.find((c) => c.id === item.id);
                      return (
                        <MenuItemRowCard
                          key={item.id}
                          item={item}
                          matchingCombo={matchingCombo}
                          isWishlisted={wishlist ? wishlist.has(item.id) : undefined}
                          onToggleWishlist={onToggleWishlist}
                          onSelectItem={onSelectItem}
                          onQuickAdd={onQuickAdd}
                          onQuickDecrement={onQuickDecrement}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        ) : (
          <div
            style={{
              padding: '48px 16px',
              textAlign: 'center',
              color: '#94a3b8',
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🍽️</div>
            <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc', marginBottom: '6px' }}>
              No dishes found
            </h4>
            <p style={{ fontSize: '0.82rem', marginBottom: '16px' }}>
              We couldn&apos;t find any items matching your active search or filters.
            </p>
            <button
              type="button"
              className="hero-action-btn"
              style={{
                display: 'inline-block',
                padding: '8px 16px',
                fontSize: '0.82rem',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#fbbf24',
                border: '1px solid rgba(251, 191, 36, 0.3)',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
              onClick={() => {
                handleSearchInput('');
                handleDietaryFilterChange('ALL');
              }}
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default MenuGrid;
