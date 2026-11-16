'use client';

import React, { useState, useEffect } from 'react';
import type {
  MenuItem,
  ModifierOption,
  ModifierGroup,
  CartLineItem,
  DinerProfile,
} from '../../types';
import { useOrderStore } from '../../store/useOrderStore';
import { FALLBACK_DISH_IMG } from '../menu/SquareItemCard';
import {
  CATEGORY_COOK_NOTE_CHIPS,
  MUTUALLY_EXCLUSIVE_CHIP_CLUSTERS,
  toggleChipInNotes,
  resolveItemModifierGroups,
  isPortionApplicable,
  getPortionPricing,
  getNotePlaceholder,
  applyProfileToContext,
} from './customizer-utils';

export {
  CATEGORY_COOK_NOTE_CHIPS,
  MUTUALLY_EXCLUSIVE_CHIP_CLUSTERS,
  toggleChipInNotes,
  resolveItemModifierGroups,
  isPortionApplicable,
  getPortionPricing,
  getNotePlaceholder,
  applyProfileToContext,
};

// ============================================================================
// Types
// ============================================================================

export interface PlateConfig {
  plateIndex: number;
  customName?: string;
  portion?: 'FULL' | 'HALF';
  spice: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE';
  notes: string;
  modifiers: ModifierOption[];
}

export interface ItemCustomizerModalProps {
  item?: MenuItem | null;
  isOpen?: boolean;
  onClose?: () => void;
  showToast?: (message: string) => void;
  onFlyToCart?: (e: React.MouseEvent, imgUrl: string) => void;
  isWishlisted?: boolean;
  onToggleWishlist?: (e: React.MouseEvent) => void;
  dinerProfiles?: DinerProfile[];
  onOpenPlateNaming?: (plateIndex: number, currentName: string) => void;
}

// ============================================================================
// Component Implementation
// ============================================================================

export function ItemCustomizerModal({
  item: propItem,
  isOpen: propIsOpen,
  onClose,
  showToast,
  onFlyToCart,
  isWishlisted: propIsWishlisted,
  onToggleWishlist,
  dinerProfiles,
  onOpenPlateNaming,
}: ItemCustomizerModalProps) {
  const storeCustomizingItem = useOrderStore((s) => s.customizingItem);
  const setStoreCustomizingItem = useOrderStore((s) => s.setCustomizingItem);
  const item = propItem !== undefined ? propItem : storeCustomizingItem;
  const isOpen = propIsOpen !== undefined ? propIsOpen : Boolean(item);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      setStoreCustomizingItem(null);
    }
  };

  const addCartLine = useOrderStore((s) => s.addCartLine);
  const storeWishlist = useOrderStore((s) => s.wishlist);
  const toggleStoreWishlist = useOrderStore((s) => s.toggleWishlist);

  // ── Internal Component State ──
  const [quantity, setQuantity] = useState(1);
  const [portion, setPortion] = useState<'FULL' | 'HALF'>('FULL');
  const [spice, setSpice] = useState<'MILD' | 'MEDIUM' | 'HOT' | 'NONE'>('MEDIUM');
  const [notes, setNotes] = useState('');
  const [selectedModifiers, setSelectedModifiers] = useState<ModifierOption[]>([]);
  const [isPerPlateSplit, setIsPerPlateSplit] = useState(false);
  const [activePlateIndex, setActivePlateIndex] = useState(1);
  const [plateConfigs, setPlateConfigs] = useState<PlateConfig[]>([]);

  // Internal plate rename popover state
  const [showInternalRenameModal, setShowInternalRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState('');

  // ── Initialize Selections Whenever `item` Changes ──
  useEffect(() => {
    if (!item) return;

    const groups = resolveItemModifierGroups(item);
    const initialMods: ModifierOption[] = [];
    groups.forEach((g) => {
      if (g.selectionType === 'SINGLE' && g.isRequired && g.modifiers.length > 0) {
        const preferred =
          g.modifiers.find((m) => {
            const nl = m.name.toLowerCase();
            return (
              (nl.includes('regular') || nl.includes('medium') || nl.includes('normal') || nl.includes('standard')) &&
              m.pricePaise === 0
            );
          }) ||
          g.modifiers.find((m) => m.pricePaise === 0) ||
          g.modifiers[0];
        if (preferred) {
          initialMods.push(preferred);
        }
      }
    });

    const initSpice = item.spiceLevel || 'MEDIUM';
    setQuantity(1);
    setPortion('FULL');
    setSpice(initSpice);
    setNotes('');
    setSelectedModifiers(initialMods);
    setIsPerPlateSplit(false);
    setActivePlateIndex(1);
    setPlateConfigs([
      {
        plateIndex: 1,
        customName: 'Plate 1',
        portion: 'FULL',
        spice: initSpice,
        notes: '',
        modifiers: [...initialMods],
      },
    ]);
    setShowInternalRenameModal(false);
  }, [item]);

  if (!isOpen || !item) {
    return null;
  }

  // ── Computed Values for Current Item ──
  const { fullPaise, halfPaise, upgradeDiffPaise } = getPortionPricing(item);
  const hasPortions = isPortionApplicable(item);
  const groups = resolveItemModifierGroups(item);
  const hasSpiceModifierGroup = groups.some((g) => g.name.toLowerCase().includes('spice'));
  const isMultiPlate = isPerPlateSplit && quantity > 1;

  const currentTotalPricePaise = isMultiPlate
    ? plateConfigs.reduce((sum, cfg) => {
        const bPrice = cfg.portion === 'HALF' ? halfPaise : fullPaise;
        const mSum = (cfg.modifiers || []).reduce((acc, m) => acc + m.pricePaise, 0);
        return sum + bPrice + mSum;
      }, 0)
    : ((portion === 'HALF' ? halfPaise : fullPaise) +
        selectedModifiers.reduce((acc, m) => acc + m.pricePaise, 0)) *
      quantity;

  const currentPlate = isMultiPlate
    ? plateConfigs.find((p) => p.plateIndex === activePlateIndex) || plateConfigs[0] || {
        plateIndex: 1,
        customName: 'Plate 1',
        portion: 'FULL',
        spice,
        notes: '',
        modifiers: [],
      }
    : null;

  const activePlateDisplayName = isMultiPlate
    ? (currentPlate?.customName || `Plate ${currentPlate?.plateIndex}`)
    : (plateConfigs[0]?.customName || 'Plate 1');

  const activePortion = isMultiPlate ? (currentPlate?.portion || 'FULL') : portion;
  const activeSpice = currentPlate ? currentPlate.spice : spice;
  const activeNote = currentPlate ? currentPlate.notes : notes;
  const activeModifiers = currentPlate ? (currentPlate.modifiers || []) : selectedModifiers;

  // ── Handlers ──
  const handleQuantityChange = (newQty: number) => {
    const q = Math.max(1, newQty);
    setQuantity(q);
    if (isPerPlateSplit) {
      setPlateConfigs((prev) => {
        const updated = [...prev];
        while (updated.length < q) {
          updated.push({
            plateIndex: updated.length + 1,
            customName: `Plate ${updated.length + 1}`,
            portion,
            spice,
            notes: '',
            modifiers: [...selectedModifiers],
          });
        }
        return updated.slice(0, q);
      });
      setActivePlateIndex((curr) => Math.min(curr, q));
    }
  };

  const handleTogglePerPlateSplit = () => {
    const nextVal = !isPerPlateSplit;
    setIsPerPlateSplit(nextVal);
    setActivePlateIndex(1);
    if (nextVal) {
      const initialConfigs = Array.from({ length: quantity }, (_, i) => ({
        plateIndex: i + 1,
        customName: `Plate ${i + 1}`,
        portion,
        spice,
        notes: notes ? `${notes} (Plate ${i + 1})` : '',
        modifiers: [...selectedModifiers],
      }));
      setPlateConfigs(initialConfigs);
    }
  };

  const onSelectPortion = (port: 'FULL' | 'HALF') => {
    if (isMultiPlate) {
      setPlateConfigs((prev) =>
        prev.map((p) => (p.plateIndex === (currentPlate?.plateIndex ?? activePlateIndex) ? { ...p, portion: port } : p))
      );
    } else {
      setPortion(port);
    }
  };

  const onSelectSpice = (sp: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE') => {
    if (isMultiPlate) {
      setPlateConfigs((prev) =>
        prev.map((p) => (p.plateIndex === (currentPlate?.plateIndex ?? activePlateIndex) ? { ...p, spice: sp } : p))
      );
    } else {
      setSpice(sp);
    }
  };

  const onChangeNote = (val: string) => {
    if (isMultiPlate) {
      setPlateConfigs((prev) =>
        prev.map((p) => (p.plateIndex === (currentPlate?.plateIndex ?? activePlateIndex) ? { ...p, notes: val } : p))
      );
    } else {
      setNotes(val);
    }
  };

  const onToggleChip = (chip: string) => {
    if (isMultiPlate) {
      setPlateConfigs((prev) =>
        prev.map((p) => {
          if (p.plateIndex !== (currentPlate?.plateIndex ?? activePlateIndex)) return p;
          const nextNotes = toggleChipInNotes(p.notes || '', chip);
          return { ...p, notes: nextNotes };
        })
      );
    } else {
      setNotes((prev) => toggleChipInNotes(prev, chip));
    }
  };

  const onToggleModifier = (mod: ModifierOption, group: ModifierGroup) => {
    const isSingle = group.selectionType === 'SINGLE';

    if (isMultiPlate) {
      setPlateConfigs((prev) =>
        prev.map((p) => {
          if (p.plateIndex !== (currentPlate?.plateIndex ?? activePlateIndex)) return p;
          const currentMods = p.modifiers || [];
          const isAlreadySelected = currentMods.some((m) => m.id === mod.id);

          let nextMods: ModifierOption[];
          if (isSingle) {
            if (isAlreadySelected) {
              nextMods = group.isRequired ? currentMods : currentMods.filter((m) => m.id !== mod.id);
            } else {
              const withoutGroup = currentMods.filter((m) => !group.modifiers.some((gm) => gm.id === m.id));
              nextMods = [...withoutGroup, mod];
            }
          } else {
            if (isAlreadySelected) {
              nextMods = currentMods.filter((m) => m.id !== mod.id);
            } else {
              const groupCount = currentMods.filter((m) => group.modifiers.some((gm) => gm.id === m.id)).length;
              if (group.maxSelections && groupCount >= group.maxSelections) {
                if (showToast) {
                  showToast(`Max ${group.maxSelections} selection${group.maxSelections > 1 ? 's' : ''} allowed`);
                }
                return p;
              }
              nextMods = [...currentMods, mod];
            }
          }
          return { ...p, modifiers: nextMods };
        })
      );
    } else {
      setSelectedModifiers((prev) => {
        const isAlreadySelected = prev.some((m) => m.id === mod.id);

        if (isSingle) {
          if (isAlreadySelected) {
            return group.isRequired ? prev : prev.filter((m) => m.id !== mod.id);
          } else {
            const withoutGroup = prev.filter((m) => !group.modifiers.some((gm) => gm.id === m.id));
            return [...withoutGroup, mod];
          }
        } else {
          if (isAlreadySelected) {
            return prev.filter((m) => m.id !== mod.id);
          } else {
            const groupCount = prev.filter((m) => group.modifiers.some((gm) => gm.id === m.id)).length;
            if (group.maxSelections && groupCount >= group.maxSelections) {
              if (showToast) {
                showToast(`Max ${group.maxSelections} selection${group.maxSelections > 1 ? 's' : ''} allowed`);
              }
              return prev;
            }
            return [...prev, mod];
          }
        }
      });
    }
  };

  const handleAddToCart = (e: React.MouseEvent) => {
    if (onFlyToCart) {
      onFlyToCart(e, item.imageUrl);
    }

    if (isMultiPlate) {
      // Split into N distinct cart lines: Plate 1, Plate 2...
      plateConfigs.forEach((cfg) => {
        const isHalf = cfg.portion === 'HALF';
        const basePaise = isHalf ? halfPaise : fullPaise;
        const portionTag = isHalf ? ' [HALF]' : '';
        const plateName = cfg.customName && cfg.customName.trim() ? cfg.customName.trim() : `Plate ${cfg.plateIndex}`;
        const line: CartLineItem = {
          cartLineId: `${item.id}-plate-${cfg.plateIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          item: { ...item, pricePaise: basePaise },
          portion: cfg.portion || 'FULL',
          plateLabel: `${plateName}${isHalf ? ' (Half)' : ''}`,
          quantity: 1,
          spiceLevel: cfg.spice,
          notes: `${cfg.notes || ''}${portionTag}`.trim() || undefined,
          selectedModifiers: cfg.modifiers,
        };
        addCartLine(line);
      });
    } else {
      // Combined single line for N plates
      const isHalf = portion === 'HALF';
      const basePaise = isHalf ? halfPaise : fullPaise;
      const portionTag = isHalf ? ' [HALF]' : '';
      const customName =
        plateConfigs[0]?.customName && plateConfigs[0].customName.trim()
          ? plateConfigs[0].customName.trim()
          : undefined;
      const newLine: CartLineItem = {
        cartLineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        item: { ...item, pricePaise: basePaise },
        portion,
        plateLabel: customName ? `${customName}${isHalf ? ' (Half)' : ''}` : undefined,
        quantity,
        spiceLevel: spice,
        notes: `${notes || ''}${portionTag}`.trim() || undefined,
        selectedModifiers,
      };
      addCartLine(newLine);
    }

    handleClose();
    if (showToast) {
      showToast(`Added ${item.name} to cart! 🍽️`);
    }
  };

  const isItemWishlisted =
    propIsWishlisted !== undefined ? propIsWishlisted : storeWishlist.includes(item.id);

  const notePlaceholder = isMultiPlate
    ? item.category === 'Beverages'
      ? `Note for Portion ${currentPlate?.plateIndex} (e.g. less ice, strong)...`
      : item.category === 'Desserts'
      ? `Note for Portion ${currentPlate?.plateIndex} (e.g. served warm, nut-free)...`
      : item.category === 'Breads'
      ? `Note for Portion ${currentPlate?.plateIndex} (e.g. extra crisp, buttered)...`
      : `Note for Plate ${currentPlate?.plateIndex} (e.g. less salt, well done)...`
    : getNotePlaceholder(item.category);

  return (
    <div className="side-drawer-wrap customizer-drawer-wrap" onClick={handleClose}>
      <div
        className="side-drawer-panel combo-drawer-panel customizer-drawer-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '560px', width: '100%', padding: 0 }}
      >
        {/* Mobile grab handle */}
        <div className="bottom-sheet-drag-handle" />

        {/* Banner / Header */}
        <div className="combo-drawer-banner">
          <img
            src={item.imageUrl || FALLBACK_DISH_IMG}
            alt={item.name}
            className="combo-drawer-banner-img"
            onError={(e) => {
              e.currentTarget.src = FALLBACK_DISH_IMG;
            }}
          />
          <div className="combo-drawer-banner-gradient">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.85rem' }}>{item.dietaryTag === 'VEG' ? '🟢' : '🔴'}</span>
                <span className="combo-card-pax-tag" style={{ position: 'static' }}>{item.category}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onToggleWishlist) {
                      onToggleWishlist(e);
                    } else {
                      toggleStoreWishlist(item.id);
                    }
                  }}
                  style={{
                    background: 'rgba(0,0,0,0.6)',
                    color: isItemWishlisted ? '#f43f5e' : '#fff',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title={isItemWishlisted ? 'In favorites' : 'Add to favorites'}
                >
                  {isItemWishlisted ? '❤️' : '🤍'}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <span style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>⏱️ {item.prepTimeMinutes} mins</span>
              <span style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 700 }}>★ {item.rating.toFixed(1)}</span>
            </div>
            <h2 className="combo-drawer-title">{item.name}</h2>
          </div>
        </div>

        {/* Scrollable Customization Content */}
        <div className="drawer-body customizer-drawer-body" style={{ padding: '16px 20px', overflowY: 'auto' }}>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.4, marginBottom: '14px' }}>
            {item.description}
          </p>

          {/* Main Dish Customization Card */}
          <div className="combo-builder-dish-card" style={{ marginBottom: '16px' }}>
            {/* Dish Card Header with Quantity Stepper */}
            <div className="combo-dish-header" style={{ marginBottom: '12px' }}>
              <div className="combo-dish-name">
                <span>{item.dietaryTag === 'VEG' ? '🟢' : '🔴'}</span>
                <span>Order Quantity:</span>
              </div>
              <div className="combo-stepper-control">
                <button
                  type="button"
                  className="combo-stepper-btn"
                  onClick={() => handleQuantityChange(quantity - 1)}
                  disabled={quantity <= 1}
                >
                  −
                </button>
                <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fbbf24', minWidth: '18px', textAlign: 'center' }}>
                  {quantity}
                </span>
                <button
                  type="button"
                  className="combo-stepper-btn"
                  onClick={() => handleQuantityChange(quantity + 1)}
                >
                  +
                </button>
              </div>
            </div>

            {/* Multi-plate split toggle: Only visible when Quantity > 1 */}
            {quantity > 1 && (
              <div
                className="plate-split-toggle-box"
                onClick={handleTogglePerPlateSplit}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: isPerPlateSplit ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                  border: isPerPlateSplit ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  marginBottom: '14px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#f8fafc', fontWeight: 600 }}>
                  <span>🔀</span>
                  <span>Customise each plate separately</span>
                </div>
                <input
                  type="checkbox"
                  checked={isPerPlateSplit}
                  onChange={handleTogglePerPlateSplit}
                  style={{ accentColor: '#f59e0b', width: '16px', height: '16px', cursor: 'pointer' }}
                />
              </div>
            )}

            {/* Horizontal Selectable Plate Tabs: ONLY when per-plate split is active */}
            {isMultiPlate && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.74rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                    Select plate to customise (tap tab):
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenPlateNaming) {
                        onOpenPlateNaming(activePlateIndex, activePlateDisplayName);
                      } else {
                        setRenameInput(activePlateDisplayName);
                        setShowInternalRenameModal(true);
                      }
                    }}
                    className="plate-assign-trigger-btn"
                    title="Rename plate or assign diner profile"
                  >
                    ✏️ {currentPlate?.customName && !currentPlate.customName.startsWith('Plate') ? currentPlate.customName : 'Assign Profile'}
                  </button>
                </div>

                <div className="combo-plate-tabs-scroll">
                  {plateConfigs.map((cfg) => {
                    const isActive = cfg.plateIndex === activePlateIndex;
                    const cfgPortion = cfg.portion || 'FULL';
                    const basePrice = cfgPortion === 'HALF' ? halfPaise : fullPaise;
                    const plateModsTotal = (cfg.modifiers || []).reduce((sum, m) => sum + m.pricePaise, 0);
                    const plateTotalPaise = basePrice + plateModsTotal;

                    return (
                      <button
                        key={cfg.plateIndex}
                        type="button"
                        className={`combo-plate-tab ${isActive ? 'active' : ''}`}
                        onClick={() => setActivePlateIndex(cfg.plateIndex)}
                      >
                        <span>🍽️ {cfg.customName || `Plate ${cfg.plateIndex}`}{cfgPortion === 'HALF' ? ' (Half)' : ''}</span>
                        <span className="combo-plate-tab-badge">
                          ₹{(plateTotalPaise / 100).toFixed(0)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Portion Size Selector (Full vs Half) */}
            {hasPortions && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc' }}>
                    Portion Size{isMultiPlate ? ` for ${activePlateDisplayName}` : ''}:
                  </span>
                  {halfPaise < fullPaise && (
                    <span style={{ fontSize: '0.72rem', color: '#fbbf24', fontWeight: 600 }}>
                      Save ₹{(upgradeDiffPaise / 100).toFixed(0)} on Half
                    </span>
                  )}
                </div>
                <div className="combo-portion-selector-grid">
                  <button
                    type="button"
                    className={`combo-portion-toggle-btn ${activePortion === 'HALF' ? 'active' : ''}`}
                    onClick={() => onSelectPortion('HALF')}
                  >
                    <div className="portion-title">
                      <span>{activePortion === 'HALF' ? '✓ ' : '○ '}Half Portion</span>
                    </div>
                    <div className="portion-subtitle">₹{(halfPaise / 100).toFixed(0)}</div>
                  </button>

                  <button
                    type="button"
                    className={`combo-portion-toggle-btn ${activePortion === 'FULL' ? 'active' : ''}`}
                    onClick={() => onSelectPortion('FULL')}
                  >
                    <div className="portion-title">
                      <span>{activePortion === 'FULL' ? '✓ ' : '○ '}Full Portion</span>
                    </div>
                    <div className="portion-subtitle">₹{(fullPaise / 100).toFixed(0)}</div>
                  </button>
                </div>
              </div>
            )}

            {/* Spice Level Preference: Shown if dish has NO spice modifier group and isn't dessert/beverage */}
            {!hasSpiceModifierGroup && item.category !== 'Desserts' && item.category !== 'Beverages' && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                  Spice Preference{isMultiPlate ? ` for ${activePlateDisplayName}` : ''}:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                  {(['MILD', 'MEDIUM', 'HOT', 'NONE'] as const).map((sp) => {
                    const isSpActive = activeSpice === sp;
                    return (
                      <button
                        key={sp}
                        type="button"
                        className={`combo-option-pill ${isSpActive ? 'active' : ''}`}
                        style={{ textAlign: 'center', padding: '8px 4px' }}
                        onClick={() => onSelectSpice(sp)}
                      >
                        {sp === 'MILD' ? '🌿 Mild' : sp === 'MEDIUM' ? '🌶️ Medium' : sp === 'HOT' ? '🔥 Hot' : '🚫 Plain'}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Modifier Groups & Add-ons */}
            {groups.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
                {groups.map((grp) => {
                  const isSingle = grp.selectionType === 'SINGLE';
                  return (
                    <div key={grp.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div>
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc' }}>{grp.name}</span>
                          {grp.isRequired && <span style={{ color: '#f59e0b', fontSize: '0.72rem', marginLeft: '6px' }}>*Required</span>}
                        </div>
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                          {isSingle ? 'Choose 1' : grp.maxSelections ? `Up to ${grp.maxSelections}` : 'Optional'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {grp.modifiers.map((mod) => {
                          const isSelected = activeModifiers.some((m) => m.id === mod.id);
                          return (
                            <div
                              key={mod.id}
                              className={`combo-addon-item-card ${isSelected ? 'selected' : ''}`}
                              onClick={() => onToggleModifier(mod, grp)}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div
                                  className="combo-addon-checkbox"
                                  style={isSingle ? { borderRadius: '50%' } : {}}
                                >
                                  {isSelected && '✓'}
                                </div>
                                <span style={{ fontSize: '0.78rem', color: isSelected ? '#fff' : '#cbd5e1', fontWeight: isSelected ? 600 : 400 }}>
                                  {mod.name}
                                </span>
                              </div>
                              <span className={`combo-addon-price-tag ${mod.pricePaise === 0 ? 'free' : ''}`}>
                                {mod.pricePaise > 0 ? `+₹${(mod.pricePaise / 100).toFixed(0)}` : 'Free'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Chef Cooking Instructions & Notes */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                Chef Instructions{isMultiPlate ? ` for ${activePlateDisplayName}` : ''}:
              </div>
              <div className="combo-pill-options-wrap">
                {(CATEGORY_COOK_NOTE_CHIPS[item.category] || [
                  'Less Oil / Less Spicy',
                  'Crispy',
                  'Extra Gravy',
                  'No Onion / Garlic',
                  'Pack Separately',
                ]).map((chip) => {
                  const isSelected = (activeNote || '').includes(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      className={`combo-option-pill ${isSelected ? 'active' : ''}`}
                      onClick={() => onToggleChip(chip)}
                    >
                      {isSelected ? '✓ ' : '+ '} {chip}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                placeholder={notePlaceholder}
                value={activeNote}
                onChange={(e) => onChangeNote(e.target.value)}
                className="combo-plate-name-input"
                style={{ marginTop: '10px' }}
                maxLength={100}
              />
            </div>
          </div>
        </div>

        {/* Sticky Footer: Total Price & Add to Order Button */}
        <div
          className="drawer-footer customizer-drawer-footer"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.1)',
            background: '#111624',
            padding: '14px 20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Total Price:</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fbbf24' }}>
                ₹{(currentTotalPricePaise / 100).toFixed(0)}
              </div>
            </div>
            <button
              type="button"
              className="hero-action-btn"
              style={{
                flex: 1,
                maxWidth: '260px',
                padding: '12px 18px',
                fontSize: '0.95rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: '#000',
                boxShadow: '0 4px 18px rgba(245, 158, 11, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                borderRadius: '10px',
                border: 'none',
                cursor: 'pointer',
              }}
              onClick={handleAddToCart}
            >
              <span>Add to Order ·</span>
              <span>₹{(currentTotalPricePaise / 100).toFixed(0)}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Internal Plate Rename & Profile Popover Modal */}
      {showInternalRenameModal && (
        <div
          className="plate-naming-modal-backdrop"
          onClick={() => setShowInternalRenameModal(false)}
          style={{ zIndex: 1100 }}
        >
          <div
            className="plate-naming-modal-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '440px', width: '90%', margin: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>✏️</span>
                  <span>Rename Plate / Assign Diner</span>
                </h3>
                <p style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '2px' }}>
                  Customise label or apply a saved profile for Plate {activePlateIndex}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInternalRenameModal(false)}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: '#94a3b8',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '6px' }}>
                Plate Label:
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  autoFocus
                  className="combo-plate-name-input"
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  placeholder="e.g. Rishi's Plate, Mom's Biryani"
                  maxLength={30}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="hero-action-btn"
                  style={{
                    padding: '0 16px',
                    borderRadius: '8px',
                    background: '#f59e0b',
                    color: '#000',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    const trimmed = renameInput.trim();
                    if (trimmed) {
                      setPlateConfigs((prev) =>
                        prev.map((p) =>
                          p.plateIndex === (currentPlate?.plateIndex ?? activePlateIndex)
                            ? { ...p, customName: trimmed }
                            : p
                        )
                      );
                    }
                    setShowInternalRenameModal(false);
                  }}
                >
                  Save
                </button>
              </div>
            </div>

            {dinerProfiles && dinerProfiles.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: '8px' }}>
                  Or select a saved diner profile:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                  {dinerProfiles.map((prof) => (
                    <button
                      key={prof.id}
                      type="button"
                      className="combo-option-pill"
                      style={{ textAlign: 'left', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      onClick={() => {
                        const applied = applyProfileToContext(prof, {
                          category: item.category,
                          itemName: item.name,
                          availableModifierGroups: groups,
                        });
                        setPlateConfigs((prev) =>
                          prev.map((p) =>
                            p.plateIndex === (currentPlate?.plateIndex ?? activePlateIndex)
                              ? {
                                  ...p,
                                  customName: applied.appliedName,
                                  spice: applied.spiceLevel !== 'NONE' ? applied.spiceLevel : p.spice,
                                  notes: applied.chefNotes || p.notes,
                                  modifiers: applied.selectedModifiers.length > 0 ? applied.selectedModifiers : p.modifiers,
                                }
                              : p
                          )
                        );
                        setShowInternalRenameModal(false);
                        if (showToast) showToast(applied.toastMessage);
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.85rem' }}>
                          👤 {prof.name} {prof.relationshipTag ? `(${prof.relationshipTag})` : ''}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                          🌶️ {prof.spicePreference} spice {prof.notes ? `· ${prof.notes}` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 600 }}>Apply →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ItemCustomizerModal;
