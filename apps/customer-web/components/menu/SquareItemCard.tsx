'use client';

import React from 'react';
import type { MenuItem } from '../../types';
import { useOrderStore } from '../../store/useOrderStore';

export const FALLBACK_DISH_IMG =
  'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=600&q=80';

export interface SquareItemCardProps {
  item: MenuItem;
  /**
   * Optional props allow backwards compatibility during incremental refactoring.
   * If omitted, values and action dispatches are resolved directly from the Zustand store.
   */
  qty?: number;
  isHearted?: boolean;
  onToggleHeart?: (e: React.MouseEvent) => void;
  onAdd?: (e: React.MouseEvent) => void;
  onDecrement?: (e: React.MouseEvent) => void;
  onOpenAccordion?: () => void;
}

export function SquareItemCard({
  item,
  qty: propQty,
  isHearted: propIsHearted,
  onToggleHeart: propOnToggleHeart,
  onAdd: propOnAdd,
  onDecrement: propOnDecrement,
  onOpenAccordion,
}: SquareItemCardProps) {
  // ── Wire to Global Zustand Store ──
  const storeQty = useOrderStore((state) => state.getItemCartQty(item.id));
  const storeIsHearted = useOrderStore((state) => state.isInWishlist(item.id));
  const toggleWishlist = useOrderStore((state) => state.toggleWishlist);
  const quickAdd = useOrderStore((state) => state.quickAdd);
  const quickDecrement = useOrderStore((state) => state.quickDecrement);

  // Derive active values: prioritize explicit props when passed, fallback to Zustand store
  const qty = propQty !== undefined ? propQty : storeQty;
  const isHearted = propIsHearted !== undefined ? propIsHearted : storeIsHearted;

  const handleToggleHeart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (propOnToggleHeart) {
      propOnToggleHeart(e);
    } else {
      toggleWishlist(item.id);
    }
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (propOnAdd) {
      propOnAdd(e);
    } else {
      quickAdd(item, () => {
        onOpenAccordion?.();
      });
    }
  };

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (propOnDecrement) {
      propOnDecrement(e);
    } else {
      quickDecrement(item.id);
    }
  };

  return (
    <div className="square-item-card">
      <div className="square-img-container" onClick={onOpenAccordion}>
        <img
          src={item.imageUrl || FALLBACK_DISH_IMG}
          alt={item.name}
          className="square-dish-img"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = FALLBACK_DISH_IMG;
          }}
        />

        {/* Dietary Dot Badge */}
        <div className="square-veg-badge">
          <span style={{ fontSize: '0.7rem' }}>{item.dietaryTag === 'VEG' ? '🟢' : '🔴'}</span>
        </div>

        {/* Wishlist Heart Button */}
        <button
          className={`square-wishlist-btn ${isHearted ? 'hearted' : ''}`}
          onClick={handleToggleHeart}
          title={isHearted ? 'In favorites' : 'Add to favorites'}
        >
          {isHearted ? '❤️' : '🤍'}
        </button>

        {/* Circular '+' Button or Quantity Stepper */}
        {qty > 0 ? (
          <div className="square-stepper-btn" onClick={(e) => e.stopPropagation()}>
            <button onClick={handleDecrement} aria-label={`Decrease quantity of ${item.name}`}>
              −
            </button>
            <span>{qty}</span>
            <button onClick={handleAdd} aria-label={`Increase quantity of ${item.name}`}>
              +
            </button>
          </div>
        ) : (
          <button
            className="square-circular-add-btn"
            onClick={handleAdd}
            title="Add to Order"
            aria-label={`Add ${item.name} to order`}
          >
            +
          </button>
        )}
      </div>

      <div className="square-card-body" onClick={onOpenAccordion}>
        <div className="square-card-name" title={item.name}>
          {item.name}
        </div>
        <div className="square-card-price">₹{(item.pricePaise / 100).toFixed(0)}</div>
      </div>
    </div>
  );
}

export default SquareItemCard;
