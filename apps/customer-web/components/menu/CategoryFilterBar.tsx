'use client';

import React from 'react';
import { DEFAULT_CATEGORIES } from './menu-constants';

export { DEFAULT_CATEGORIES };

export interface CategoryFilterBarProps {
  categories?: readonly string[];
  activeCategory: string;
  onSelectCategory: (category: string) => void;
  className?: string;
}

export function CategoryFilterBar({
  categories = DEFAULT_CATEGORIES,
  activeCategory,
  onSelectCategory,
  className = '',
}: CategoryFilterBarProps) {
  return (
    <nav className={`menu-category-nav ${className}`.trim()}>
      {categories.map((cat) => (
        <button
          key={cat}
          id={`pill-${cat}`}
          type="button"
          className={`category-nav-pill ${activeCategory === cat ? 'active' : ''}`}
          onClick={() => onSelectCategory(cat)}
        >
          {cat === 'Combos' ? '🔥 Combos' : cat}
        </button>
      ))}
    </nav>
  );
}

export default CategoryFilterBar;
