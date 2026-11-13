'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { consoleAuthFetch } from '../lib/auth-client';
import { formatPaise } from '../lib/restaurant-db';

interface ApiCategory {
  id: string;
  name: string;
  name_i18n?: Record<string, string>;
  outlet_id: string | null;
  sort_order: number;
}

interface ApiMenuItem {
  id: string;
  category_id: string;
  outlet_id: string | null;
  name: string;
  name_i18n?: Record<string, string>;
  description_i18n?: Record<string, string>;
  price_paise: number;
  veg_type: 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN';
  allergens?: string[];
  is_available: boolean;
  sort_order: number;
  prep_time_min?: number | null;
  calories?: number | null;
  spice_level: number;
  allow_half_portion?: boolean;
  half_price_paise?: number | null;
  image_url?: string | null;
}

interface MenuCatalogManagerProps {
  outletId?: string | null;
  outletName?: string;
  onToast?: (msg: string) => void;
}

/**
 * Resize and compress a user-selected food image file in the browser via HTML5 Canvas
 * so mobile/DSLR photos upload cleanly under API limits and convert to WebP server-side.
 */
async function compressImageFileToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode selected image file.'));
      el.src = objectUrl;
    });
    const maxDim = 900;
    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser canvas is unavailable.');
    }
    ctx.drawImage(img, 0, 0, width, height);
    const webp = canvas.toDataURL('image/webp', 0.85);
    if (webp.startsWith('data:image/webp')) {
      return webp;
    }
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function MenuCatalogManager({
  outletId,
  outletName,
  onToast,
}: MenuCatalogManagerProps) {
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [items, setItems] = useState<ApiMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Item Modal state
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ApiMenuItem | null>(null);
  const [itemCategoryId, setItemCategoryId] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemNameHindi, setItemNameHindi] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPriceRupees, setItemPriceRupees] = useState('320');
  const [itemVegType, setItemVegType] = useState<'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN'>('VEG');
  const [itemSpiceLevel, setItemSpiceLevel] = useState('1');
  const [itemAllowHalf, setItemAllowHalf] = useState(false);
  const [itemHalfPriceRupees, setItemHalfPriceRupees] = useState('200');
  const [itemPrepTime, setItemPrepTime] = useState('15');
  const [itemCalories, setItemCalories] = useState('');
  const [itemAllergens, setItemAllergens] = useState('');
  const [itemIsAvailable, setItemIsAvailable] = useState(true);
  const [itemImageUrl, setItemImageUrl] = useState('');
  const [pendingPhotoDataUrl, setPendingPhotoDataUrl] = useState<string | null>(null);
  const [clearPhotoOnSave, setClearPhotoOnSave] = useState(false);
  const [modalError, setModalError] = useState('');
  const [saving, setSaving] = useState(false);

  // Category Modal state
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ApiCategory | null>(null);
  const [catName, setCatName] = useState('');
  const [catSortOrder, setCatSortOrder] = useState('0');
  const [catError, setCatError] = useState('');

  const notify = (msg: string) => {
    if (onToast) onToast(msg);
  };

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const qs = outletId ? `?outlet_id=${encodeURIComponent(outletId)}` : '';
      const [catRes, itemRes] = await Promise.all([
        consoleAuthFetch(`/api/v1/console/menu/categories${qs}`),
        consoleAuthFetch(`/api/v1/console/menu/items${qs}`),
      ]);
      if (!catRes.ok || !itemRes.ok) {
        setLoadError('Could not load menu catalog from server.');
        setLoading(false);
        return;
      }
      const catData = (await catRes.json()) as ApiCategory[];
      const itemData = (await itemRes.json()) as ApiMenuItem[];
      setCategories(Array.isArray(catData) ? catData : []);
      setItems(Array.isArray(itemData) ? itemData : []);
    } catch {
      setLoadError('Network error while loading menu catalog.');
    } finally {
      setLoading(false);
    }
  }, [outletId]);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  const openCreateItemModal = () => {
    setEditingItem(null);
    setItemCategoryId(
      (selectedCategoryId !== 'ALL' ? selectedCategoryId : categories[0]?.id) || '',
    );
    setItemName('');
    setItemNameHindi('');
    setItemDescription('');
    setItemPriceRupees('250');
    setItemVegType('VEG');
    setItemSpiceLevel('1');
    setItemAllowHalf(false);
    setItemHalfPriceRupees('160');
    setItemPrepTime('15');
    setItemCalories('');
    setItemAllergens('');
    setItemIsAvailable(true);
    setItemImageUrl('');
    setPendingPhotoDataUrl(null);
    setClearPhotoOnSave(false);
    setModalError('');
    setShowItemModal(true);
  };

  const openEditItemModal = (item: ApiMenuItem) => {
    setEditingItem(item);
    setItemCategoryId(item.category_id);
    setItemName(item.name);
    setItemNameHindi(item.name_i18n?.['hi'] || '');
    setItemDescription(item.description_i18n?.['en'] || '');
    setItemPriceRupees((item.price_paise / 100).toFixed(0));
    setItemVegType(item.veg_type || 'VEG');
    setItemSpiceLevel(String(item.spice_level ?? 0));
    setItemAllowHalf(Boolean(item.allow_half_portion));
    setItemHalfPriceRupees(
      item.half_price_paise ? (item.half_price_paise / 100).toFixed(0) : '',
    );
    setItemPrepTime(item.prep_time_min != null ? String(item.prep_time_min) : '15');
    setItemCalories(item.calories != null ? String(item.calories) : '');
    setItemAllergens((item.allergens || []).join(', '));
    setItemIsAvailable(item.is_available !== false);
    setItemImageUrl(item.image_url || '');
    setPendingPhotoDataUrl(null);
    setClearPhotoOnSave(false);
    setModalError('');
    setShowItemModal(true);
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setModalError('');
    try {
      const compressedDataUrl = await compressImageFileToDataUrl(file);
      setPendingPhotoDataUrl(compressedDataUrl);
      setClearPhotoOnSave(false);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not process image file.');
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    const priceNum = Number.parseFloat(itemPriceRupees);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setModalError('Enter a valid positive Full Plate Price.');
      return;
    }
    const pricePaise = Math.round(priceNum * 100);
    const halfNum = itemAllowHalf ? Number.parseFloat(itemHalfPriceRupees || '0') : 0;
    if (itemAllowHalf && (!Number.isFinite(halfNum) || halfNum <= 0)) {
      setModalError('Enter a valid positive Half Plate Price or disable Half Plate.');
      return;
    }
    const halfPricePaise = itemAllowHalf ? Math.round(halfNum * 100) : null;
    if (!itemCategoryId) {
      setModalError('Please create or select a category first.');
      return;
    }

    const allergensList = itemAllergens
      .split(',')
      .map((a) => a.trim().toUpperCase())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      name: itemName.trim(),
      category_id: itemCategoryId,
      name_i18n: {
        en: itemName.trim(),
        ...(itemNameHindi.trim() ? { hi: itemNameHindi.trim() } : {}),
      },
      description_i18n: {
        ...(itemDescription.trim() ? { en: itemDescription.trim() } : {}),
      },
      price_paise: pricePaise,
      veg_type: itemVegType,
      allergens: allergensList,
      is_available: itemIsAvailable,
      spice_level: Math.min(5, Math.max(0, Number.parseInt(itemSpiceLevel || '0', 10) || 0)),
      prep_time_min: itemPrepTime.trim() ? Math.max(0, Number.parseInt(itemPrepTime, 10) || 0) : null,
      calories: itemCalories.trim() ? Math.max(0, Number.parseInt(itemCalories, 10) || 0) : null,
      allow_half_portion: itemAllowHalf,
      half_price_paise: halfPricePaise,
    };

    if (!editingItem && outletId) {
      payload['outlet_id'] = outletId;
    }

    if (!pendingPhotoDataUrl) {
      if (clearPhotoOnSave) {
        payload['image_url'] = null;
      } else if (itemImageUrl.trim()) {
        payload['image_url'] = itemImageUrl.trim();
      } else if (editingItem?.image_url) {
        payload['image_url'] = null;
      }
    }

    setSaving(true);
    try {
      const endpoint = editingItem
        ? `/api/v1/console/menu/items/${encodeURIComponent(editingItem.id)}`
        : '/api/v1/console/menu/items';
      const res = await consoleAuthFetch(endpoint, {
        method: editingItem ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { detail?: string; message?: string } | null;
        setModalError(errBody?.detail || errBody?.message || 'Failed to save menu item.');
        setSaving(false);
        return;
      }

      const saved = (await res.json()) as { id: string };
      const targetItemId = saved.id || editingItem?.id;

      if (targetItemId && pendingPhotoDataUrl) {
        const photoRes = await consoleAuthFetch(
          `/api/v1/console/menu/items/${encodeURIComponent(targetItemId)}/photo`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_url: pendingPhotoDataUrl }),
          },
        );
        if (!photoRes.ok) {
          const errBody = (await photoRes.json().catch(() => null)) as { detail?: string; message?: string } | null;
          setModalError(errBody?.detail || errBody?.message || 'Dish saved, but food photo upload failed.');
          await fetchCatalog();
          setSaving(false);
          return;
        }
      } else if (targetItemId && clearPhotoOnSave && !pendingPhotoDataUrl) {
        await consoleAuthFetch(
          `/api/v1/console/menu/items/${encodeURIComponent(targetItemId)}/photo`,
          { method: 'DELETE' },
        );
      }

      await fetchCatalog();
      setShowItemModal(false);
      notify(`✅ ${editingItem ? 'Updated' : 'Added'} dish: ${itemName.trim()}`);
    } catch {
      setModalError('Network error while saving dish.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAvailability = async (item: ApiMenuItem) => {
    const next = !item.is_available;
    const res = await consoleAuthFetch(`/api/v1/console/menu/items/${encodeURIComponent(item.id)}/stock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_available: next }),
    });
    if (res.ok) {
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, is_available: next } : it)));
      notify(`${next ? '✅ Marked available' : '🚫 Marked 86 / Out of Stock'}: ${item.name}`);
    } else {
      notify('⚠️ Failed to update item stock status.');
    }
  };

  const handleArchiveItem = async (item: ApiMenuItem) => {
    if (!confirm(`Remove "${item.name}" from the digital menu?`)) return;
    const res = await consoleAuthFetch(`/api/v1/console/menu/items/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    });
    if (res.ok) {
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      notify(`🗑️ Removed "${item.name}" from menu`);
    } else {
      notify('⚠️ Could not remove dish.');
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setCatError('');
    if (!catName.trim()) {
      setCatError('Category name is required.');
      return;
    }
    const endpoint = editingCategory
      ? `/api/v1/console/menu/categories/${encodeURIComponent(editingCategory.id)}`
      : '/api/v1/console/menu/categories';
    const body: Record<string, unknown> = {
      name: catName.trim(),
      name_i18n: { en: catName.trim() },
      sort_order: Math.max(0, Number.parseInt(catSortOrder || '0', 10) || 0),
    };
    if (!editingCategory && outletId) {
      body['outlet_id'] = outletId;
    }
    const res = await consoleAuthFetch(endpoint, {
      method: editingCategory ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { detail?: string; message?: string } | null;
      setCatError(errBody?.detail || errBody?.message || 'Failed to save category.');
      return;
    }
    await fetchCatalog();
    setShowCategoryModal(false);
    notify(`✅ ${editingCategory ? 'Renamed' : 'Created'} category: ${catName.trim()}`);
  };

  const categoryNameMap = new Map(categories.map((c) => [c.id, c.name]));
  const filteredItems = items.filter((it) => {
    if (selectedCategoryId !== 'ALL' && it.category_id !== selectedCategoryId) {
      return false;
    }
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      it.name.toLowerCase().includes(q) ||
      (it.name_i18n?.['hi'] || '').toLowerCase().includes(q) ||
      (it.description_i18n?.['en'] || '').toLowerCase().includes(q)
    );
  });

  const previewSrc =
    pendingPhotoDataUrl || (!clearPhotoOnSave && itemImageUrl.trim() ? itemImageUrl.trim() : '');

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 900 }}>Menu &amp; Food Photo Editor</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
            {categories.length} Categories · {items.length} Live Dishes
            {outletName ? ` · ${outletName}` : ''}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search dish..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              background: 'var(--bg-surface)',
              color: '#fff',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 12px',
              fontSize: '0.84rem',
              width: '200px',
            }}
          />
          <button
            type="button"
            onClick={() => {
              setEditingCategory(null);
              setCatName('');
              setCatSortOrder(String(categories.length));
              setCatError('');
              setShowCategoryModal(true);
            }}
            className="btn-secondary"
          >
            + Category
          </button>
          <button type="button" onClick={openCreateItemModal} className="btn-primary">
            + Add New Dish
          </button>
        </div>
      </div>

      {/* Category Filter Strip */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', overflowX: 'auto', paddingBottom: '4px' }}>
        <button
          type="button"
          onClick={() => setSelectedCategoryId('ALL')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 700,
            fontSize: '0.84rem',
            background: selectedCategoryId === 'ALL' ? 'var(--accent-cyan)' : 'var(--bg-surface)',
            color: selectedCategoryId === 'ALL' ? '#000' : 'var(--text-secondary)',
            border: '1px solid var(--border-light)',
            whiteSpace: 'nowrap',
          }}
        >
          All Categories ({items.length})
        </button>
        {categories.map((cat) => (
          <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <button
              type="button"
              onClick={() => setSelectedCategoryId(cat.id)}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 700,
                fontSize: '0.84rem',
                background: selectedCategoryId === cat.id ? 'var(--accent-cyan)' : 'var(--bg-surface)',
                color: selectedCategoryId === cat.id ? '#000' : 'var(--text-secondary)',
                border: '1px solid var(--border-light)',
                whiteSpace: 'nowrap',
              }}
            >
              {cat.name} ({items.filter((i) => i.category_id === cat.id).length})
            </button>
            {selectedCategoryId === cat.id && (
              <button
                type="button"
                title="Rename category"
                onClick={() => {
                  setEditingCategory(cat);
                  setCatName(cat.name);
                  setCatSortOrder(String(cat.sort_order ?? 0));
                  setCatError('');
                  setShowCategoryModal(true);
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--border-light)',
                  color: '#cbd5e1',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                }}
              >
                ✏️
              </button>
            )}
          </div>
        ))}
      </div>

      {loadError && (
        <div
          style={{
            background: 'rgba(244, 63, 94, 0.14)',
            border: '1px solid var(--accent-rose)',
            color: '#fff',
            padding: '12px 16px',
            borderRadius: '10px',
            marginBottom: '16px',
            fontSize: '0.86rem',
          }}
        >
          ⚠️ {loadError}
        </div>
      )}

      {/* Dishes Table */}
      <div className="data-table-container">
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading live menu catalog...
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No dishes found in this view. Click <strong>+ Add New Dish</strong> to add one.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Photo &amp; Dish</th>
                <th>Category</th>
                <th>Diet</th>
                <th>Price</th>
                <th>Prep / Cal</th>
                <th>Stock</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '52px',
                          height: '52px',
                          borderRadius: '10px',
                          overflow: 'hidden',
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid var(--border-light)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          fontSize: '22px',
                        }}
                      >
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={item.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          '🍽️'
                        )}
                      </div>
                      <div>
                        <div style={{ fontWeight: 800 }}>
                          {item.name}
                          {item.name_i18n?.['hi'] ? (
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 500, marginLeft: '6px', fontSize: '0.78rem' }}>
                              ({item.name_i18n['hi']})
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '280px' }}>
                          {item.description_i18n?.['en'] || 'No description'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {categoryNameMap.get(item.category_id) || 'Menu'}
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 800,
                        color:
                          item.veg_type === 'VEG'
                            ? '#10b981'
                            : item.veg_type === 'VEGAN'
                            ? '#06b6d4'
                            : item.veg_type === 'EGG'
                            ? '#fbbf24'
                            : '#f43f5e',
                      }}
                    >
                      ● {item.veg_type}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 800, color: 'var(--accent-cyan)' }}>
                      {formatPaise(item.price_paise)}
                    </div>
                    {item.allow_half_portion && item.half_price_paise && (
                      <div style={{ fontSize: '0.74rem', color: '#fbbf24', fontWeight: 600 }}>
                        Half: {formatPaise(item.half_price_paise)}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <div>{item.prep_time_min ?? 15} mins</div>
                    {item.calories ? <div>{item.calories} kcal</div> : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => void handleToggleAvailability(item)}
                      className={`status-chip ${item.is_available ? 'chip-green' : 'chip-red'}`}
                      style={{ cursor: 'pointer', border: 'none' }}
                      title="Click to toggle availability"
                    >
                      {item.is_available ? 'ACTIVE' : '86 OUT'}
                    </button>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => openEditItemModal(item)}
                        style={{
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid var(--border-light)',
                          padding: '5px 10px',
                          borderRadius: '6px',
                          fontSize: '0.78rem',
                          color: '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        ✏️ Edit / Photo
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleArchiveItem(item)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.12)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '5px 8px',
                          borderRadius: '6px',
                          fontSize: '0.78rem',
                          color: '#f87171',
                          cursor: 'pointer',
                        }}
                        title="Remove dish from menu"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ========================================================
          DISH + FOOD PHOTO EDITOR MODAL
          ======================================================== */}
      {showItemModal && (
        <div className="modal-overlay" onClick={() => setShowItemModal(false)}>
          <div
            className="modal-content"
            style={{
              maxWidth: '580px',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#0f172a',
              border: '1px solid var(--accent-cyan)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 900 }}>
                  {editingItem ? `Edit Dish: ${editingItem.name}` : 'Add New Menu Item'}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                  Updates sync immediately to Customer Digital Menu (Owner &amp; Manager access)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowItemModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div
                style={{
                  background: 'rgba(244, 63, 94, 0.15)',
                  border: '1px solid var(--accent-rose)',
                  color: '#fff',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  marginBottom: '12px',
                }}
              >
                ⚠️ {modalError}
              </div>
            )}

            <form onSubmit={handleSaveItem} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Food Photo Picker / Uploader */}
              <div
                style={{
                  background: 'rgba(6, 182, 212, 0.08)',
                  border: '1px solid rgba(6, 182, 212, 0.25)',
                  borderRadius: '10px',
                  padding: '12px',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--accent-cyan)', marginBottom: '8px' }}>
                  📸 Food Photo
                </div>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div
                    style={{
                      width: '88px',
                      height: '88px',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      background: 'rgba(15, 23, 42, 0.85)',
                      border: '1px solid var(--border-light)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '30px',
                      flexShrink: 0,
                    }}
                  >
                    {previewSrc ? (
                      <img
                        src={previewSrc}
                        alt="Food preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      '🍽️'
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <label
                        style={{
                          background: 'var(--accent-cyan)',
                          color: '#000',
                          fontWeight: 800,
                          fontSize: '0.78rem',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        Upload Photo File
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/avif"
                          onChange={handlePhotoFileChange}
                          style={{ display: 'none' }}
                        />
                      </label>
                      {(previewSrc || editingItem?.image_url) && (
                        <button
                          type="button"
                          onClick={() => {
                            setPendingPhotoDataUrl(null);
                            setItemImageUrl('');
                            setClearPhotoOnSave(true);
                          }}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            color: '#f87171',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            padding: '6px 10px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                          }}
                        >
                          Remove Photo
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="Or paste photo https:// URL"
                      value={itemImageUrl}
                      onChange={(e) => {
                        setItemImageUrl(e.target.value);
                        setPendingPhotoDataUrl(null);
                        setClearPhotoOnSave(false);
                      }}
                      className="form-input"
                      style={{ fontSize: '0.8rem', padding: '7px 10px' }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label">Category *</label>
                  <select
                    value={itemCategoryId}
                    onChange={(e) => setItemCategoryId(e.target.value)}
                    required
                    className="form-input"
                  >
                    <option value="">Select category...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Dietary Type *</label>
                  <select
                    value={itemVegType}
                    onChange={(e) => setItemVegType(e.target.value as 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN')}
                    className="form-input"
                  >
                    <option value="VEG">VEG</option>
                    <option value="NON_VEG">NON_VEG</option>
                    <option value="EGG">EGG</option>
                    <option value="VEGAN">VEGAN</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label">Dish Name (English) *</label>
                  <input
                    type="text"
                    required
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="e.g. Paneer Tikka"
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Hindi Name (Optional)</label>
                  <input
                    type="text"
                    value={itemNameHindi}
                    onChange={(e) => setItemNameHindi(e.target.value)}
                    placeholder="e.g. पनीर टिक्का"
                    className="form-input"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Description</label>
                <input
                  type="text"
                  value={itemDescription}
                  onChange={(e) => setItemDescription(e.target.value)}
                  placeholder="Fresh cottage cheese marinated in spiced yogurt..."
                  className="form-input"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label">Full Plate Price (₹) *</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    value={itemPriceRupees}
                    onChange={(e) => setItemPriceRupees(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Spice Level (0–3)</label>
                  <select
                    value={itemSpiceLevel}
                    onChange={(e) => setItemSpiceLevel(e.target.value)}
                    className="form-input"
                  >
                    <option value="0">0 — Mild / Not Spicy</option>
                    <option value="1">1 — Gentle Spice</option>
                    <option value="2">2 — Medium Spicy</option>
                    <option value="3">3 — Hot &amp; Spicy</option>
                  </select>
                </div>
              </div>

              {/* Half Plate Option */}
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 700, color: '#fbbf24', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={itemAllowHalf}
                    onChange={(e) => setItemAllowHalf(e.target.checked)}
                  />
                  Allow Half Plate Portion Option
                </label>
                {itemAllowHalf && (
                  <div style={{ marginTop: '8px' }}>
                    <label className="form-label" style={{ fontSize: '0.74rem' }}>Half Plate Price (₹)</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={itemHalfPriceRupees}
                      onChange={(e) => setItemHalfPriceRupees(e.target.value)}
                      className="form-input"
                    />
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="form-label">Prep Time (min)</label>
                  <input
                    type="number"
                    min="0"
                    value={itemPrepTime}
                    onChange={(e) => setItemPrepTime(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Calories (kcal)</label>
                  <input
                    type="number"
                    min="0"
                    value={itemCalories}
                    onChange={(e) => setItemCalories(e.target.value)}
                    placeholder="420"
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Allergens</label>
                  <input
                    type="text"
                    value={itemAllergens}
                    onChange={(e) => setItemAllergens(e.target.value)}
                    placeholder="DAIRY, NUTS"
                    className="form-input"
                  />
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', color: '#cbd5e1', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={itemIsAvailable}
                  onChange={(e) => setItemIsAvailable(e.target.checked)}
                />
                Item Currently Available (uncheck to mark 86 Out of Stock)
              </label>

              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary"
                  style={{ flex: 1, opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? 'Saving...' : '💾 Save Dish & Photo'}
                </button>
                <button type="button" onClick={() => setShowItemModal(false)} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          CATEGORY MODAL
          ======================================================== */}
      {showCategoryModal && (
        <div className="modal-overlay" onClick={() => setShowCategoryModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '420px', background: '#0f172a', border: '1px solid var(--accent-cyan)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '1.15rem', fontWeight: 900, marginBottom: '12px' }}>
              {editingCategory ? 'Rename Category' : 'Add Menu Category'}
            </h3>
            {catError && (
              <div style={{ color: '#f87171', fontSize: '0.82rem', marginBottom: '10px' }}>⚠️ {catError}</div>
            )}
            <form onSubmit={handleSaveCategory} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="form-label">Category Name *</label>
                <input
                  type="text"
                  required
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="e.g. Signature Starters"
                  className="form-input"
                />
              </div>
              <div>
                <label className="form-label">Sort Order</label>
                <input
                  type="number"
                  min="0"
                  value={catSortOrder}
                  onChange={(e) => setCatSortOrder(e.target.value)}
                  className="form-input"
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                  💾 Save Category
                </button>
                <button type="button" onClick={() => setShowCategoryModal(false)} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

