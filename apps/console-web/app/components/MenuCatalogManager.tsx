'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { consoleAuthFetch } from '../lib/auth-client';
import { formatPaise } from '../lib/restaurant-db';

export interface ApiCategory {
  id: string;
  name: string;
  name_i18n?: Record<string, string>;
  outlet_id: string | null;
  sort_order: number;
}

export interface ApiModifierOption {
  id: string;
  group_id: string;
  name: string;
  price_paise: number;
  is_default: boolean;
  is_available: boolean;
  sort_order: number;
}

export interface ApiModifierGroup {
  id: string;
  outlet_id: string | null;
  name: string;
  selection_type: 'SINGLE' | 'MULTI' | 'MULTIPLE';
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  is_active: boolean;
  options?: ApiModifierOption[];
}

export interface ApiMenuItem {
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
  modifier_groups?: ApiModifierGroup[];
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
    const maxDim = 800;
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
    const webp = canvas.toDataURL('image/webp', 0.8);
    if (webp.startsWith('data:image/webp')) {
      return webp;
    }
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function MenuCatalogManager({
  outletId,
  outletName,
  onToast,
}: MenuCatalogManagerProps) {
  // Top-level tab switcher: Dishes vs Customizations
  const [activeCatalogTab, setActiveCatalogTab] = useState<'DISHES' | 'CUSTOMIZATIONS'>('DISHES');

  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [items, setItems] = useState<ApiMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Modifier Groups & Customizations state
  const [allModifierGroups, setAllModifierGroups] = useState<ApiModifierGroup[]>([]);
  const [loadingModifiers, setLoadingModifiers] = useState(false);

  // Group Create/Edit Modal state
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ApiModifierGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupSelectionType, setGroupSelectionType] = useState<'SINGLE' | 'MULTI'>('SINGLE');
  const [groupIsRequired, setGroupIsRequired] = useState(false);
  const [groupMinSelect, setGroupMinSelect] = useState('0');
  const [groupMaxSelect, setGroupMaxSelect] = useState('1');
  const [groupModalError, setGroupModalError] = useState('');
  const [groupSaving, setGroupSaving] = useState(false);

  // New Option creation inline state (group_id -> { name, priceRupees })
  const [newOptionData, setNewOptionData] = useState<Record<string, { name: string; priceRupees: string }>>({});

  // Item Modal state
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ApiMenuItem | null>(null);
  const [itemCategoryId, setItemCategoryId] = useState('');
  const [itemName, setItemName] = useState('');
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

  // Dish modal: selected group to attach
  const [selectedGroupToAttach, setSelectedGroupToAttach] = useState<string>('');

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

  const fetchModifierGroups = useCallback(async () => {
    setLoadingModifiers(true);
    try {
      const qs = outletId ? `?outlet_id=${encodeURIComponent(outletId)}` : '';
      const res = await consoleAuthFetch(`/api/v1/console/menu/modifier-groups${qs}`);
      if (res.ok) {
        const data = (await res.json()) as ApiModifierGroup[];
        setAllModifierGroups(Array.isArray(data) ? data : []);
      }
    } catch {
      console.warn('Failed to load modifier groups');
    } finally {
      setLoadingModifiers(false);
    }
  }, [outletId]);

  useEffect(() => {
    void fetchCatalog();
    void fetchModifierGroups();
  }, [fetchCatalog, fetchModifierGroups]);

  const openCreateItemModal = () => {
    setEditingItem(null);
    setItemCategoryId(
      (selectedCategoryId !== 'ALL' ? selectedCategoryId : categories[0]?.id) || '',
    );
    setItemName('');
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
    setSelectedGroupToAttach('');
    setShowItemModal(true);
  };

  const openEditItemModal = (item: ApiMenuItem) => {
    setEditingItem(item);
    setItemCategoryId(item.category_id);
    setItemName(item.name);
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
    setSelectedGroupToAttach('');
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
        payload['image_url'] = editingItem.image_url;
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
      notify('⚠️ Failed to archive menu item.');
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setCatError('');
    if (!catName.trim()) {
      setCatError('Category name is required.');
      return;
    }
    const sortOrderNum = Number.parseInt(catSortOrder || '0', 10) || 0;
    try {
      if (editingCategory) {
        const res = await consoleAuthFetch(
          `/api/v1/console/menu/categories/${encodeURIComponent(editingCategory.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: catName.trim(),
              sort_order: sortOrderNum,
            }),
          },
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { detail?: string } | null;
          setCatError(err?.detail || 'Failed to update category.');
          return;
        }
        notify(`✅ Renamed category to: ${catName.trim()}`);
      } else {
        const payload: Record<string, unknown> = {
          name: catName.trim(),
          sort_order: sortOrderNum,
        };
        if (outletId) payload['outlet_id'] = outletId;
        const res = await consoleAuthFetch('/api/v1/console/menu/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { detail?: string } | null;
          setCatError(err?.detail || 'Failed to create category.');
          return;
        }
        notify(`✅ Created category: ${catName.trim()}`);
      }
      setShowCategoryModal(false);
      await fetchCatalog();
    } catch {
      setCatError('Network error while saving category.');
    }
  };

  // ─── Customization / Modifier Handlers ─────────────────────────────────────────

  const openCreateGroupModal = () => {
    setEditingGroup(null);
    setGroupName('');
    setGroupSelectionType('SINGLE');
    setGroupIsRequired(false);
    setGroupMinSelect('0');
    setGroupMaxSelect('1');
    setGroupModalError('');
    setShowGroupModal(true);
  };

  const openEditGroupModal = (group: ApiModifierGroup) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupSelectionType(group.selection_type === 'SINGLE' ? 'SINGLE' : 'MULTI');
    setGroupIsRequired(group.is_required);
    setGroupMinSelect(String(group.min_select ?? 0));
    setGroupMaxSelect(String(group.max_select ?? 1));
    setGroupModalError('');
    setShowGroupModal(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setGroupModalError('');
    if (!groupName.trim()) {
      setGroupModalError('Group name is required.');
      return;
    }
    const min = Number.parseInt(groupMinSelect || '0', 10) || 0;
    const max = Number.parseInt(groupMaxSelect || '1', 10) || 1;
    if (max < min) {
      setGroupModalError('Maximum select must be greater than or equal to minimum select.');
      return;
    }

    setGroupSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: groupName.trim(),
        selection_type: groupSelectionType,
        is_required: groupIsRequired,
        min_select: min,
        max_select: max,
        sort_order: 0,
        is_active: true,
      };
      if (outletId) payload['outlet_id'] = outletId;

      const endpoint = editingGroup
        ? `/api/v1/console/menu/modifier-groups/${encodeURIComponent(editingGroup.id)}`
        : '/api/v1/console/menu/modifier-groups';

      const res = await consoleAuthFetch(endpoint, {
        method: editingGroup ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { detail?: string; message?: string } | null;
        setGroupModalError(err?.detail || err?.message || 'Failed to save modifier group.');
        setGroupSaving(false);
        return;
      }

      setShowGroupModal(false);
      await fetchModifierGroups();
      await fetchCatalog();
      notify(`✅ ${editingGroup ? 'Updated' : 'Created'} customization group: ${groupName.trim()}`);
    } catch {
      setGroupModalError('Network error while saving customization group.');
    } finally {
      setGroupSaving(false);
    }
  };

  const handleDeleteGroup = async (group: ApiModifierGroup) => {
    if (!confirm(`Delete customization group "${group.name}"? This removes it from all dishes.`)) return;
    const res = await consoleAuthFetch(`/api/v1/console/menu/modifier-groups/${encodeURIComponent(group.id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await fetchModifierGroups();
      await fetchCatalog();
      notify(`🗑️ Deleted customization group: ${group.name}`);
    } else {
      notify('⚠️ Could not delete modifier group.');
    }
  };

  const handleAttachGroupToDish = async (itemId: string, groupId: string) => {
    if (!groupId) return;
    const res = await consoleAuthFetch(
      `/api/v1/console/menu/items/${encodeURIComponent(itemId)}/modifier-groups/${encodeURIComponent(groupId)}`,
      { method: 'POST' },
    );
    if (res.ok) {
      await fetchCatalog();
      // Update local editingItem
      const updatedItemRes = await consoleAuthFetch(`/api/v1/console/menu/items?outlet_id=${encodeURIComponent(outletId || '')}`);
      if (updatedItemRes.ok) {
        const all = (await updatedItemRes.json()) as ApiMenuItem[];
        const current = all.find((i) => i.id === itemId);
        if (current) setEditingItem(current);
      }
      setSelectedGroupToAttach('');
      notify('✅ Attached customization group to dish.');
    } else {
      notify('⚠️ Could not attach customization group.');
    }
  };

  const handleDetachGroupFromDish = async (itemId: string, groupId: string) => {
    const res = await consoleAuthFetch(
      `/api/v1/console/menu/items/${encodeURIComponent(itemId)}/modifier-groups/${encodeURIComponent(groupId)}`,
      { method: 'DELETE' },
    );
    if (res.ok) {
      await fetchCatalog();
      if (editingItem) {
        setEditingItem({
          ...editingItem,
          modifier_groups: (editingItem.modifier_groups || []).filter((g) => g.id !== groupId),
        });
      }
      notify('🗑️ Detached customization group from dish.');
    } else {
      notify('⚠️ Could not detach customization group.');
    }
  };

  const handleCreateOption = async (groupId: string) => {
    const data = newOptionData[groupId];
    if (!data || !data.name.trim()) {
      notify('⚠️ Option name is required.');
      return;
    }
    const priceNum = Number.parseFloat(data.priceRupees || '0');
    const pricePaise = Math.max(0, Math.round((Number.isFinite(priceNum) ? priceNum : 0) * 100));

    const res = await consoleAuthFetch('/api/v1/console/menu/modifiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: groupId,
        name: data.name.trim(),
        price_paise: pricePaise,
        is_default: false,
        is_available: true,
        sort_order: 0,
      }),
    });

    if (res.ok) {
      setNewOptionData((prev) => ({ ...prev, [groupId]: { name: '', priceRupees: '0' } }));
      await fetchModifierGroups();
      await fetchCatalog();
      if (editingItem) {
        const itemRes = await consoleAuthFetch(`/api/v1/console/menu/items?outlet_id=${encodeURIComponent(outletId || '')}`);
        if (itemRes.ok) {
          const all = (await itemRes.json()) as ApiMenuItem[];
          const current = all.find((i) => i.id === editingItem.id);
          if (current) setEditingItem(current);
        }
      }
      notify(`✅ Added option: ${data.name.trim()} (₹${priceNum})`);
    } else {
      notify('⚠️ Failed to add option.');
    }
  };

  const handleUpdateOption = async (
    optionId: string,
    updates: Partial<{ name: string; price_paise: number; is_default: boolean; is_available: boolean }>,
  ) => {
    const res = await consoleAuthFetch(`/api/v1/console/menu/modifiers/${encodeURIComponent(optionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      await fetchModifierGroups();
      await fetchCatalog();
      if (editingItem) {
        const itemRes = await consoleAuthFetch(`/api/v1/console/menu/items?outlet_id=${encodeURIComponent(outletId || '')}`);
        if (itemRes.ok) {
          const all = (await itemRes.json()) as ApiMenuItem[];
          const current = all.find((i) => i.id === editingItem.id);
          if (current) setEditingItem(current);
        }
      }
      notify('✅ Customization option updated.');
    } else {
      notify('⚠️ Failed to update option.');
    }
  };

  const handleDeleteOption = async (optionId: string) => {
    if (!confirm('Delete this customization option?')) return;
    const res = await consoleAuthFetch(`/api/v1/console/menu/modifiers/${encodeURIComponent(optionId)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await fetchModifierGroups();
      await fetchCatalog();
      if (editingItem) {
        const itemRes = await consoleAuthFetch(`/api/v1/console/menu/items?outlet_id=${encodeURIComponent(outletId || '')}`);
        if (itemRes.ok) {
          const all = (await itemRes.json()) as ApiMenuItem[];
          const current = all.find((i) => i.id === editingItem.id);
          if (current) setEditingItem(current);
        }
      }
      notify('🗑️ Deleted customization option.');
    } else {
      notify('⚠️ Failed to delete option.');
    }
  };

  const filteredItems = items.filter((item) => {
    if (selectedCategoryId !== 'ALL' && item.category_id !== selectedCategoryId) {
      return false;
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const inName = item.name.toLowerCase().includes(q);
      const inDesc = (item.description_i18n?.['en'] || '').toLowerCase().includes(q);
      return inName || inDesc;
    }
    return true;
  });

  return (
    <div>
      {/* Catalog Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 900 }}>Live Menu Catalog &amp; Customizations</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            100% database-driven dishes, food photography, and customizable add-on groups for {outletName || 'this outlet'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {activeCatalogTab === 'DISHES' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditingCategory(null);
                  setCatName('');
                  setCatSortOrder(String(categories.length + 1));
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
            </>
          )}
          {activeCatalogTab === 'CUSTOMIZATIONS' && (
            <button type="button" onClick={openCreateGroupModal} className="btn-primary">
              + New Customization Group
            </button>
          )}
        </div>
      </div>

      {/* Primary Sub-Tabs: Dishes vs Customizations */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <button
          type="button"
          onClick={() => setActiveCatalogTab('DISHES')}
          style={{
            padding: '10px 18px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 800,
            fontSize: '0.88rem',
            background: activeCatalogTab === 'DISHES' ? 'var(--accent-cyan)' : 'var(--bg-surface)',
            color: activeCatalogTab === 'DISHES' ? '#000' : 'var(--text-secondary)',
            border: '1px solid var(--border-light)',
            cursor: 'pointer',
          }}
        >
          🍽️ Dishes &amp; Categories ({items.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveCatalogTab('CUSTOMIZATIONS')}
          style={{
            padding: '10px 18px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 800,
            fontSize: '0.88rem',
            background: activeCatalogTab === 'CUSTOMIZATIONS' ? 'var(--accent-cyan)' : 'var(--bg-surface)',
            color: activeCatalogTab === 'CUSTOMIZATIONS' ? '#000' : 'var(--text-secondary)',
            border: '1px solid var(--border-light)',
            cursor: 'pointer',
          }}
        >
          ✨ Customizations &amp; Add-ons ({allModifierGroups.length} Groups)
        </button>
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

      {/* ========================================================
          TAB 1: DISHES & CATEGORIES VIEW
          ======================================================== */}
      {activeCatalogTab === 'DISHES' && (
        <>
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
                {selectedCategoryId === cat.id && items.filter((i) => i.category_id === cat.id).length === 0 && (
                  <button
                    type="button"
                    title="Remove empty category"
                    onClick={async () => {
                      if (!confirm(`Delete empty category "${cat.name}"?`)) return;
                      const res = await consoleAuthFetch(`/api/v1/console/menu/categories/${encodeURIComponent(cat.id)}`, {
                        method: 'DELETE',
                      });
                      if (res.ok) {
                        setSelectedCategoryId('ALL');
                        await fetchCatalog();
                        notify(`🗑️ Category "${cat.name}" removed.`);
                      } else {
                        notify('⚠️ Could not remove category.');
                      }
                    }}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '6px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      color: '#f87171',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                    }}
                  >
                    🗑️
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Search Box */}
          <div style={{ marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="🔍 Search dishes by name or ingredients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input"
              style={{ maxWidth: '420px' }}
            />
          </div>

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
                    <th>Customizations</th>
                    <th>Stock</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const catObj = categories.find((c) => c.id === item.category_id);
                    const attachedGroups = item.modifier_groups || [];
                    return (
                      <tr key={item.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div
                              style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '8px',
                                overflow: 'hidden',
                                background: '#1e293b',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                border: '1px solid var(--border-light)',
                              }}
                            >
                              {item.image_url ? (
                                <img
                                  src={item.image_url}
                                  alt={item.name}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              ) : (
                                <span style={{ fontSize: '1.4rem' }}>
                                  {item.veg_type === 'NON_VEG' ? '🍗' : '🥦'}
                                </span>
                              )}
                            </div>
                            <div>
                              <div style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.94rem' }}>
                                {item.name}
                              </div>
                              {item.description_i18n?.['en'] && (
                                <div style={{ fontSize: '0.78rem', color: '#94a3b8', maxWidth: '320px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {item.description_i18n['en']}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ color: '#cbd5e1' }}>{catObj?.name || 'Unassigned'}</td>
                        <td>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              background:
                                item.veg_type === 'VEG'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : item.veg_type === 'NON_VEG'
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : 'rgba(245, 158, 11, 0.15)',
                              color:
                                item.veg_type === 'VEG'
                                  ? '#10b981'
                                  : item.veg_type === 'NON_VEG'
                                  ? '#ef4444'
                                  : '#f59e0b',
                            }}
                          >
                            {item.veg_type}
                          </span>
                        </td>
                        <td style={{ fontWeight: 800, color: '#f8fafc' }}>
                          {formatPaise(item.price_paise)}
                          {item.allow_half_portion && item.half_price_paise && (
                            <div style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 500 }}>
                              Half: {formatPaise(item.half_price_paise)}
                            </div>
                          )}
                        </td>
                        <td>
                          {attachedGroups.length === 0 ? (
                            <span style={{ color: '#64748b', fontSize: '0.78rem' }}>None</span>
                          ) : (
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {attachedGroups.map((g) => (
                                <span
                                  key={g.id}
                                  style={{
                                    background: 'rgba(6, 182, 212, 0.12)',
                                    color: 'var(--accent-cyan)',
                                    border: '1px solid rgba(6, 182, 212, 0.25)',
                                    borderRadius: '4px',
                                    padding: '2px 6px',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                  }}
                                >
                                  {g.name} ({g.options?.length || 0})
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => handleToggleAvailability(item)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '0.76rem',
                              fontWeight: 800,
                              cursor: 'pointer',
                              background: item.is_available ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: item.is_available ? '#10b981' : '#f87171',
                              border: `1px solid ${item.is_available ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                            }}
                          >
                            {item.is_available ? 'In Stock' : '86 Stock'}
                          </button>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => openEditItemModal(item)}
                              className="btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                            >
                              ✏️ Edit &amp; Customize
                            </button>
                            <button
                              type="button"
                              onClick={() => handleArchiveItem(item)}
                              style={{
                                background: 'rgba(239, 68, 68, 0.12)',
                                color: '#f87171',
                                border: '1px solid rgba(239, 68, 68, 0.25)',
                                borderRadius: '6px',
                                padding: '4px 8px',
                                fontSize: '0.78rem',
                                cursor: 'pointer',
                              }}
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ========================================================
          TAB 2: CUSTOMIZATIONS & MODIFIER GROUPS MANAGER
          ======================================================== */}
      {activeCatalogTab === 'CUSTOMIZATIONS' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              Manage portion sizes, spice levels, bread choices, and paid add-ons. Changes sync instantly across all dishes and customer apps.
            </p>
          </div>

          {loadingModifiers ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading customization groups...
            </div>
          ) : allModifierGroups.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>✨</div>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', marginBottom: '4px' }}>No Customization Groups Configured</div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', maxWidth: '400px', margin: '0 auto 16px' }}>
                Add modifier groups like "Portion Size", "Bread Choice", or "Extra Toppings" and attach them to dishes.
              </p>
              <button type="button" onClick={openCreateGroupModal} className="btn-primary">
                + Create First Customization Group
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {allModifierGroups.map((group) => {
                const optInput = newOptionData[group.id] || { name: '', priceRupees: '0' };
                const linkedItemsCount = items.filter((it) =>
                  (it.modifier_groups || []).some((g) => g.id === group.id),
                ).length;

                return (
                  <div
                    key={group.id}
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-light)',
                      borderRadius: '12px',
                      padding: '20px',
                    }}
                  >
                    {/* Group Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <h3 style={{ fontSize: '1.15rem', fontWeight: 900, color: '#f8fafc' }}>
                          {group.name}
                        </h3>
                        <span
                          style={{
                            background: group.selection_type === 'SINGLE' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(168, 85, 247, 0.15)',
                            color: group.selection_type === 'SINGLE' ? '#60a5fa' : '#c084fc',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                          }}
                        >
                          {group.selection_type === 'SINGLE' ? 'Single Choice (Radio)' : `Multi Choice (Min ${group.min_select}, Max ${group.max_select})`}
                        </span>
                        {group.is_required && (
                          <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
                            REQUIRED
                          </span>
                        )}
                        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                          Linked to {linkedItemsCount} dish{linkedItemsCount === 1 ? '' : 'es'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => openEditGroupModal(group)}
                          className="btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                        >
                          ✏️ Edit Group
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteGroup(group)}
                          style={{
                            background: 'rgba(239, 68, 68, 0.12)',
                            color: '#f87171',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {/* Options Table */}
                    <div style={{ marginBottom: '14px' }}>
                      {(group.options || []).length === 0 ? (
                        <div style={{ fontSize: '0.82rem', color: '#64748b', fontStyle: 'italic', padding: '8px 0' }}>
                          No options added to this group yet. Add options below.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {group.options!.map((opt) => (
                            <div
                              key={opt.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'rgba(255, 255, 255, 0.02)',
                                border: '1px solid var(--border-light)',
                                borderRadius: '8px',
                                padding: '8px 14px',
                                gap: '12px',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                                <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.88rem' }}>
                                  {opt.name}
                                </span>
                                {opt.is_default && (
                                  <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '1px 6px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: 800 }}>
                                    DEFAULT
                                  </span>
                                )}
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>Price (₹):</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    defaultValue={(opt.price_paise / 100).toFixed(0)}
                                    onBlur={(e) => {
                                      const val = Number.parseFloat(e.target.value || '0');
                                      const newPaise = Math.max(0, Math.round((Number.isFinite(val) ? val : 0) * 100));
                                      if (newPaise !== opt.price_paise) {
                                        void handleUpdateOption(opt.id, { price_paise: newPaise });
                                      }
                                    }}
                                    style={{
                                      width: '80px',
                                      padding: '4px 8px',
                                      borderRadius: '4px',
                                      background: '#0f172a',
                                      border: '1px solid var(--border-light)',
                                      color: '#f8fafc',
                                      fontWeight: 800,
                                      fontSize: '0.84rem',
                                    }}
                                  />
                                </div>

                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#cbd5e1', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={opt.is_available}
                                    onChange={(e) => handleUpdateOption(opt.id, { is_available: e.target.checked })}
                                  />
                                  Available
                                </label>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteOption(opt.id)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#f87171',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    padding: '2px 4px',
                                  }}
                                  title="Delete Option"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Add Option Row */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        background: 'rgba(6, 182, 212, 0.05)',
                        border: '1px dashed rgba(6, 182, 212, 0.3)',
                        borderRadius: '8px',
                        padding: '10px 14px',
                      }}
                    >
                      <input
                        type="text"
                        placeholder="New option name (e.g. Extra Cheese, Half, Butter Naan)"
                        value={optInput.name}
                        onChange={(e) =>
                          setNewOptionData((prev) => ({
                            ...prev,
                            [group.id]: { ...optInput, name: e.target.value },
                          }))
                        }
                        className="form-input"
                        style={{ flex: 1, padding: '6px 10px', fontSize: '0.82rem' }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>₹</span>
                        <input
                          type="number"
                          placeholder="Price"
                          min="0"
                          step="1"
                          value={optInput.priceRupees}
                          onChange={(e) =>
                            setNewOptionData((prev) => ({
                              ...prev,
                              [group.id]: { ...optInput, priceRupees: e.target.value },
                            }))
                          }
                          className="form-input"
                          style={{ width: '80px', padding: '6px 10px', fontSize: '0.82rem' }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCreateOption(group.id)}
                        className="btn-primary"
                        style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                      >
                        + Add Option
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          EDIT / ADD DISH MODAL (WITH CUSTOMIZATIONS SECTION)
          ======================================================== */}
      {showItemModal && (
        <div className="modal-overlay" onClick={() => setShowItemModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>
                {editingItem ? '✏️ Edit Dish & Customizations' : '🍽️ Add New Menu Dish'}
              </h3>
              <button
                type="button"
                onClick={() => setShowItemModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div style={{ color: '#f87171', fontSize: '0.82rem', marginBottom: '12px' }}>
                ⚠️ {modalError}
              </div>
            )}

            <form onSubmit={handleSaveItem} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Photo Upload Area */}
              <div>
                <label className="form-label">Dish Photograph (WebP Auto-optimized)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '6px' }}>
                  <div
                    style={{
                      width: '72px',
                      height: '72px',
                      borderRadius: '10px',
                      background: '#1e293b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      border: '1.5px solid var(--border-light)',
                      flexShrink: 0,
                    }}
                  >
                    {pendingPhotoDataUrl ? (
                      <img src={pendingPhotoDataUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : itemImageUrl && !clearPhotoOnSave ? (
                      <img src={itemImageUrl} alt="Dish" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '1.8rem' }}>📷</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoFileChange}
                      style={{ fontSize: '0.8rem', color: '#94a3b8' }}
                    />
                    {(itemImageUrl || pendingPhotoDataUrl) && !clearPhotoOnSave && (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingPhotoDataUrl(null);
                          setClearPhotoOnSave(true);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#f87171',
                          fontSize: '0.78rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        🗑️ Remove Photo
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Category & Veg Type */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label">Category *</label>
                  <select
                    required
                    value={itemCategoryId}
                    onChange={(e) => setItemCategoryId(e.target.value)}
                    className="form-input"
                  >
                    <option value="" disabled>Select Category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Dietary Type *</label>
                  <select
                    value={itemVegType}
                    onChange={(e) => setItemVegType(e.target.value as any)}
                    className="form-input"
                  >
                    <option value="VEG">VEG</option>
                    <option value="NON_VEG">NON_VEG</option>
                    <option value="EGG">EGG</option>
                    <option value="VEGAN">VEGAN</option>
                  </select>
                </div>
              </div>

              {/* Dish Name (English Only - Hindi field removed per spec) */}
              <div>
                <label className="form-label">Dish Name *</label>
                <input
                  type="text"
                  required
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="e.g. Paneer Tikka Charcoal Char"
                  className="form-input"
                />
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

              {/* ========================================================
                  CUSTOMIZATIONS & ADD-ONS (MODIFIERS) SECTION
                  ======================================================== */}
              {editingItem && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '16px',
                    borderRadius: '10px',
                    background: 'rgba(6, 182, 212, 0.04)',
                    border: '1.5px solid rgba(6, 182, 212, 0.25)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div>
                      <h4 style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
                        ✨ Customizations &amp; Add-ons for this Dish
                      </h4>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                        Attach modifier groups (e.g. Spice Preference, Accompaniments, Bread Choice)
                      </p>
                    </div>
                  </div>

                  {/* Attached Groups List */}
                  {(!editingItem.modifier_groups || editingItem.modifier_groups.length === 0) ? (
                    <div style={{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '0.82rem', background: '#0f172a', borderRadius: '8px', marginBottom: '12px' }}>
                      No customization groups attached to this dish yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '14px' }}>
                      {editingItem.modifier_groups.map((group) => {
                        const optInput = newOptionData[group.id] || { name: '', priceRupees: '0' };
                        return (
                          <div
                            key={group.id}
                            style={{
                              background: '#0f172a',
                              border: '1px solid var(--border-light)',
                              borderRadius: '8px',
                              padding: '12px',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.9rem' }}>
                                  {group.name}
                                </span>
                                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                  ({group.selection_type})
                                </span>
                                {group.is_required && (
                                  <span style={{ fontSize: '0.68rem', color: '#f87171', fontWeight: 800 }}>REQ</span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDetachGroupFromDish(editingItem.id, group.id)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#f87171',
                                  fontSize: '0.76rem',
                                  cursor: 'pointer',
                                }}
                              >
                                ✕ Detach
                              </button>
                            </div>

                            {/* Options */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
                              {(group.options || []).map((opt) => (
                                <div
                                  key={opt.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '4px 8px',
                                    background: 'rgba(255, 255, 255, 0.02)',
                                    borderRadius: '4px',
                                    fontSize: '0.78rem',
                                  }}
                                >
                                  <span style={{ color: '#f8fafc' }}>{opt.name}</span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ color: '#10b981', fontWeight: 700 }}>
                                      {opt.price_paise > 0 ? `+${formatPaise(opt.price_paise)}` : 'Free'}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteOption(opt.id)}
                                      style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Add Option Row */}
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <input
                                type="text"
                                placeholder="New option name"
                                value={optInput.name}
                                onChange={(e) =>
                                  setNewOptionData((prev) => ({
                                    ...prev,
                                    [group.id]: { ...optInput, name: e.target.value },
                                  }))
                                }
                                className="form-input"
                                style={{ flex: 1, padding: '4px 8px', fontSize: '0.76rem' }}
                              />
                              <input
                                type="number"
                                placeholder="₹ Extra"
                                min="0"
                                value={optInput.priceRupees}
                                onChange={(e) =>
                                  setNewOptionData((prev) => ({
                                    ...prev,
                                    [group.id]: { ...optInput, priceRupees: e.target.value },
                                  }))
                                }
                                className="form-input"
                                style={{ width: '70px', padding: '4px 8px', fontSize: '0.76rem' }}
                              />
                              <button
                                type="button"
                                onClick={() => handleCreateOption(group.id)}
                                className="btn-secondary"
                                style={{ padding: '4px 8px', fontSize: '0.76rem' }}
                              >
                                + Add
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Attach Existing Group Dropdown */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      value={selectedGroupToAttach}
                      onChange={(e) => setSelectedGroupToAttach(e.target.value)}
                      className="form-input"
                      style={{ flex: 1, fontSize: '0.82rem' }}
                    >
                      <option value="">-- Attach a Customization Group --</option>
                      {allModifierGroups
                        .filter((g) => !(editingItem.modifier_groups || []).some((att) => att.id === g.id))
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} ({g.selection_type}, {g.options?.length || 0} options)
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={!selectedGroupToAttach}
                      onClick={() => handleAttachGroupToDish(editingItem.id, selectedGroupToAttach)}
                      className="btn-primary"
                      style={{ padding: '8px 12px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                    >
                      + Attach
                    </button>
                  </div>
                </div>
              )}

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
          MODIFIER GROUP MODAL (CREATE / EDIT)
          ======================================================== */}
      {showGroupModal && (
        <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '440px', background: '#0f172a', border: '1px solid var(--accent-cyan)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '1.2rem', fontWeight: 900, marginBottom: '12px' }}>
              {editingGroup ? '✏️ Edit Customization Group' : '✨ Create Customization Group'}
            </h3>
            {groupModalError && (
              <div style={{ color: '#f87171', fontSize: '0.82rem', marginBottom: '10px' }}>
                ⚠️ {groupModalError}
              </div>
            )}
            <form onSubmit={handleSaveGroup} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="form-label">Group Name *</label>
                <input
                  type="text"
                  required
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g. Portion Size, Spice Level, Bread Choice"
                  className="form-input"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="form-label">Selection Mode *</label>
                  <select
                    value={groupSelectionType}
                    onChange={(e) => setGroupSelectionType(e.target.value as 'SINGLE' | 'MULTI')}
                    className="form-input"
                  >
                    <option value="SINGLE">Single Choice (Radio)</option>
                    <option value="MULTI">Multi Choice (Checkboxes)</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Max Select</label>
                  <input
                    type="number"
                    min="1"
                    disabled={groupSelectionType === 'SINGLE'}
                    value={groupSelectionType === 'SINGLE' ? '1' : groupMaxSelect}
                    onChange={(e) => setGroupMaxSelect(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', color: '#cbd5e1', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={groupIsRequired}
                  onChange={(e) => setGroupIsRequired(e.target.checked)}
                />
                Mandatory selection required before adding to order
              </label>

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button type="submit" disabled={groupSaving} className="btn-primary" style={{ flex: 1 }}>
                  {groupSaving ? 'Saving...' : '💾 Save Group'}
                </button>
                <button type="button" onClick={() => setShowGroupModal(false)} className="btn-secondary">
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
