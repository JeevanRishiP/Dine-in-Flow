'use client';

import React from 'react';
import type { MenuItem, ComboOffer } from '../../types';
import { useOrderStore } from '../../store/useOrderStore';
import { FALLBACK_DISH_IMG } from './SquareItemCard';

// ============================================================================
// Props Interface
// ============================================================================

export interface MenuItemRowCardProps {
  item: MenuItem;
  matchingCombo?: ComboOffer;
  cartQty?: number;
  isWishlisted?: boolean;
  onToggleWishlist?: (itemId: string, e: React.MouseEvent) => void;
  onSelectItem: (item: MenuItem) => void;
  onQuickAdd?: (item: MenuItem, e: React.MouseEvent) => void;
  onQuickDecrement?: (itemId: string, e: React.MouseEvent) => void;
}

// ============================================================================
// Component Implementation
// ============================================================================

export function MenuItemRowCard({
  item,
  matchingCombo,
  cartQty: propCartQty,
  isWishlisted: propIsWishlisted,
  onToggleWishlist,
  onSelectItem,
  onQuickAdd,
  onQuickDecrement,
}: MenuItemRowCardProps) {
  // Wire to Zustand store
  const storeCartQty = useOrderStore((s) => s.getItemCartQty(item.id));
  const storeIsInWishlist = useOrderStore((s) => s.isInWishlist(item.id));
  const storeToggleWishlist = useOrderStore((s) => s.toggleWishlist);
  const storeQuickAdd = useOrderStore((s) => s.quickAdd);
  const storeQuickDecrement = useOrderStore((s) => s.quickDecrement);

  const cartQty = propCartQty !== undefined ? propCartQty : storeCartQty;
  const isWishlisted = propIsWishlisted !== undefined ? propIsWishlisted : storeIsInWishlist;

  const handleToggleHeart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleWishlist) {
      onToggleWishlist(item.id, e);
    } else {
      storeToggleWishlist(item.id);
    }
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onQuickAdd) {
      onQuickAdd(item, e);
    } else {
      storeQuickAdd(item, () => onSelectItem(item));
    }
  };

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onQuickDecrement) {
      onQuickDecrement(item.id, e);
    } else {
      storeQuickDecrement(item.id);
    }
  };

  return (
    <div
      id={`menu-item-${item.id}`}
      className={`menu-item-row-card ${item.category === 'Combos' ? 'combo-item-highlight' : ''}`}
    >
      {/* Main Row */}
      <div
        className="menu-item-main-row"
        onClick={() => onSelectItem(item)}
        style={{ cursor: 'pointer' }}
      >
        <div className="menu-item-details">
          <div className="item-badge-row">
            <span style={{ fontSize: '0.75rem' }}>
              {item.dietaryTag === 'VEG' ? '🟢' : '🔴'}
            </span>
            <span className="item-prep-badge">⏱️ {item.prepTimeMinutes} mins</span>
            <span style={{ fontSize: '0.72rem', color: '#fbbf24' }}>
              ★ {item.rating.toFixed(1)}
            </span>
            {matchingCombo && (
              <span
                className="combo-card-pax-tag"
                style={{ position: 'static', padding: '2px 6px', fontSize: '0.64rem' }}
              >
                {matchingCombo.tag}
              </span>
            )}
          </div>

          <div className="menu-item-name">{item.name}</div>
          <p className="menu-item-desc">{item.description}</p>

          <div className="menu-item-price-row">
            <span className="menu-item-price">₹{(item.pricePaise / 100).toFixed(0)}</span>
            {matchingCombo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    fontSize: '0.76rem',
                    color: '#64748b',
                    textDecoration: 'line-through',
                  }}
                >
                  ₹{(matchingCombo.originalPricePaise / 100).toFixed(0)}
                </span>
                <span
                  style={{
                    fontSize: '0.64rem',
                    fontWeight: 800,
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                  }}
                >
                  {matchingCombo.badge}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={handleToggleHeart}
              style={{
                fontSize: '0.85rem',
                color: isWishlisted ? '#f43f5e' : 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                padding: 0,
              }}
              title={isWishlisted ? 'Remove from favorites' : 'Save to favorites'}
            >
              {isWishlisted ? '❤️' : '🤍'}
            </button>
          </div>
        </div>

        {/* Media Column with Image & Overlapping Add Button */}
        <div className="menu-item-media-col" onClick={(e) => e.stopPropagation()}>
          <div className="menu-item-thumb-wrap" onClick={() => onSelectItem(item)}>
            <img
              src={item.imageUrl || FALLBACK_DISH_IMG}
              alt={item.name}
              className="menu-item-thumb-img"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.src = FALLBACK_DISH_IMG;
              }}
            />
          </div>

          <div className="menu-item-add-btn-wrap">
            {cartQty > 0 ? (
              <div className="menu-stepper-wrap">
                <button type="button" onClick={handleDecrement}>
                  −
                </button>
                <span>{cartQty}</span>
                <button type="button" onClick={handleAdd}>
                  +
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="menu-add-btn"
                style={
                  item.category === 'Combos'
                    ? { padding: '5px 8px', fontSize: '0.72rem', whiteSpace: 'nowrap' }
                    : undefined
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectItem(item);
                }}
              >
                <span>{item.category === 'Combos' ? 'Customize +' : 'Add +'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MenuItemRowCard;
