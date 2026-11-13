'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ORGANIZATION,
  OUTLETS,
  ALL_STAFF_MEMBERS,
  getBranchData,
  formatPaise,
  formatOrderDateTime,
  type Outlet,
  type Order,
  type Table,
  type MenuItem,
  type MenuCategory,
  type Invoice,
  type Payment,
  type Coupon,
  type FeedbackReview,
  type StaffMember,
  BRANCH_1_CATEGORIES,
  BRANCH_1_MENU_ITEMS,
  getStoredOutlets,
  saveStoredOutlet,
  getStoredStaff,
  saveStoredStaffMember,
  deleteStoredStaffMember,
  getLoggedInUser,
} from '../lib/restaurant-db';
import {
  getConsoleAuthState,
  loginStaffRemote,
  verifyStaffMfaRemote,
  logoutStaffRemote,
  consoleAuthFetch,
  isAuthStateExpired,
  fetchConsoleStaffDirectory,
  createConsoleStaffMember,
  updateConsoleStaffMember,
  deactivateConsoleStaffMember,
} from '../lib/auth-client';
import MenuCatalogManager from '../components/MenuCatalogManager';

export type OwnerScreen =
  | 'DASHBOARD'
  | 'ORDERS'
  | 'MENU'
  | 'TABLES'
  | 'PAYMENTS'
  | 'LOYALTY'
  | 'FEEDBACK'
  | 'STAFF'
  | 'SETTINGS';

export default function OwnerWebApp() {
  // Server-backed JWT & Pre-MFA TOTP State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const state = getConsoleAuthState();
      return Boolean(state && !isAuthStateExpired(state, 0) && state.user.role === 'OWNER');
    }
    return false;
  });
  const [orgSlug, setOrgSlug] = useState(
    () => process.env['NEXT_PUBLIC_DEFAULT_ORG_SLUG'] || '',
  );
  const [showOrgSlug, setShowOrgSlug] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showOwnerPass, setShowOwnerPass] = useState(false);
  const [preMfaToken, setPreMfaToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [loginStep, setLoginStep] = useState<'CREDENTIALS' | 'TOTP'>('CREDENTIALS');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Sync auth state from verified session
  useEffect(() => {
    const state = getConsoleAuthState();
    if (state && !isAuthStateExpired(state, 0) && state.user.role === 'OWNER') {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Persistent Top Bar Shell State: Dynamic Stored Outlets
  const [outletsList, setOutletsList] = useState<Outlet[]>(() =>
    typeof window !== 'undefined' ? getStoredOutlets() : OUTLETS
  );
  const [selectedOutletId, setSelectedOutletId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const stored = getStoredOutlets();
      return stored[0]?.id ?? OUTLETS[0]!.id;
    }
    return OUTLETS[0]!.id;
  });
  const [dateRange, setDateRange] = useState<'TODAY' | 'YESTERDAY' | 'WEEK' | 'MONTH'>('TODAY');
  const [activeScreen, setActiveScreen] = useState<OwnerScreen>('DASHBOARD');

  // Hotel Creation Modal State
  const [showAddHotelModal, setShowAddHotelModal] = useState(false);
  const [hotelName, setHotelName] = useState('');
  const [hotelShortName, setHotelShortName] = useState('');
  const [hotelAddress, setHotelAddress] = useState('');
  const [hotelPhone, setHotelPhone] = useState('');

  // Chart view toggles (Dashboard)
  const [chartMetric, setChartMetric] = useState<'REVENUE' | 'ORDERS' | 'AOV'>('REVENUE');
  const [chartViewMode, setChartViewMode] = useState<'HOURLY' | 'DAILY'>('HOURLY');

  // Orders Filter State (Screen 2)
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'ALL' | 'BILLED' | 'ACTIVE' | 'CANCELLED'>('ALL');
  const [selectedOrderDrawer, setSelectedOrderDrawer] = useState<Order | null>(null);

  // Menu State (Screen 3 fallback data for overview analytics)
  const currentBranchData = getBranchData(selectedOutletId);
  const [categories, setCategories] = useState<MenuCategory[]>(currentBranchData.categories);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(currentBranchData.menuItems);
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('Main Course');

  // Tables & QR State (Screen 4)
  const [tables, setTables] = useState<Table[]>(currentBranchData.tables);
  const [showQrSheetModal, setShowQrSheetModal] = useState(false);
  const [qrModalTable, setQrModalTable] = useState<Table | null>(null);

  // Payments & Invoices Tab (Screen 5)
  const [paymentsSubTab, setPaymentsSubTab] = useState<'PAYMENTS' | 'INVOICES'>('PAYMENTS');
  const [selectedInvoiceModal, setSelectedInvoiceModal] = useState<Invoice | null>(null);

  // Loyalty & Coupons (Screen 6)
  const [coupons, setCoupons] = useState<Coupon[]>(currentBranchData.coupons);
  const [showCreateCouponModal, setShowCreateCouponModal] = useState(false);

  // Feedback & Reviews (Screen 7)
  const [feedbackList, setFeedbackList] = useState<FeedbackReview[]>(currentBranchData.feedback);
  const [selectedFeedbackDrawer, setSelectedFeedbackDrawer] = useState<FeedbackReview | null>(null);
  const [replyInput, setReplyInput] = useState('');

  // Staff Management State (Screen 8 — backed by PostgreSQL via /api/v1/console/staff)
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [staffName, setStaffName] = useState('');
  const [staffOutletId, setStaffOutletId] = useState<string>('ALL');
  const [staffRole, setStaffRole] = useState<StaffMember['role']>('CAPTAIN');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [showStaffModalPass, setShowStaffModalPass] = useState(false);
  const [staffIsActive, setStaffIsActive] = useState(true);
  const [staffModalError, setStaffModalError] = useState('');
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffPhone, setStaffPhone] = useState('');
  const [staffAvatar, setStaffAvatar] = useState('👨‍💼');
  const [staffFilterOutlet, setStaffFilterOutlet] = useState<string>('ALL');

  const loadServerStaffDirectory = async () => {
    const auth = getConsoleAuthState();
    if (!auth || auth.user.role !== 'OWNER') return;
    setStaffLoading(true);
    const res = await fetchConsoleStaffDirectory();
    setStaffLoading(false);
    if (!res.ok || !res.data) {
      return;
    }
    const roleAvatar: Record<string, string> = {
      OWNER: '👔',
      MANAGER: '📋',
      CAPTAIN: '👨‍💼',
      KITCHEN: '👨‍🍳',
      CASHIER: '👩‍💼',
      WAITER: '🤵',
    };
    const mappedStaff: StaffMember[] = res.data.staff.map((s) => ({
      id: s.id,
      orgId: s.orgId,
      name: s.displayName,
      email: s.email,
      username: s.username,
      phone: s.phone || '',
      role: s.role,
      avatar: roleAvatar[s.role] || '👤',
      outletId: s.outletId,
      isActive: s.isActive,
    }));
    setStaffList(mappedStaff);

    if (res.data.outlets.length > 0) {
      const mappedOutlets: Outlet[] = res.data.outlets.map((o) => ({
        id: o.id,
        orgId: res.data!.orgId,
        name: o.name,
        shortName: o.name,
        address: o.address || '',
        timezone: 'Asia/Kolkata',
        isActive: o.isActive,
      }));
      setOutletsList(mappedOutlets);
      if (!mappedOutlets.some((o) => o.id === selectedOutletId)) {
        setSelectedOutletId(mappedOutlets[0]!.id);
      }
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      void loadServerStaffDirectory();
    }
  }, [isAuthenticated]);

  // Listen for dynamic storage updates
  useEffect(() => {
    const handleSync = () => {
      void loadServerStaffDirectory();
    };
    window.addEventListener('dineflow-data-updated', handleSync);
    return () => {
      window.removeEventListener('dineflow-data-updated', handleSync);
    };
  }, []);

  // Sync state whenever outlet changes
  const handleOutletChange = (newOutletId: string) => {
    setSelectedOutletId(newOutletId);
    const data = getBranchData(newOutletId);
    setCategories(data.categories);
    setMenuItems(data.menuItems);
    setTables(data.tables);
    setCoupons(data.coupons);
    setFeedbackList(data.feedback);
    if (data.categories.length > 0) {
      setSelectedCategoryName(data.categories[0]!.name);
    }
  };

  // Clone Menu from Indiranagar Flagship to blank branch
  const handleCloneMenu = () => {
    setCategories(BRANCH_1_CATEGORIES);
    setMenuItems(BRANCH_1_MENU_ITEMS);
    setSelectedCategoryName('Main Course');
  };

  // Hotel creation handler
  const handleCreateHotel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotelName.trim()) {
      showToast('⚠️ Please enter a hotel name');
      return;
    }
    const newOutlet: Outlet = {
      id: `b${Date.now().toString(16).padEnd(31, '0')}`,
      orgId: ORGANIZATION.id,
      name: hotelName.trim(),
      shortName: hotelShortName.trim() || hotelName.trim().slice(0, 16),
      address: hotelAddress.trim() || 'Bangalore, India',
      timezone: 'Asia/Kolkata',
      isActive: true,
    };
    const updated = saveStoredOutlet(newOutlet);
    setOutletsList(updated);
    handleOutletChange(newOutlet.id);
    setShowAddHotelModal(false);
    setHotelName('');
    setHotelShortName('');
    setHotelAddress('');
    setHotelPhone('');
    showToast(`🏨 Added new hotel: ${newOutlet.name}`);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dineflow-data-updated'));
    }
  };

  // Staff creation / edit handlers (Owner-only via PostgreSQL API)
  const openAddStaffModal = () => {
    setEditingStaff(null);
    setStaffName('');
    setStaffOutletId(selectedOutletId || 'ALL');
    setStaffRole('CAPTAIN');
    setStaffUsername('');
    setStaffPassword('');
    setShowStaffModalPass(false);
    setStaffIsActive(true);
    setStaffModalError('');
    setStaffPhone('');
    setStaffAvatar('👨‍💼');
    setShowStaffModal(true);
  };

  const openEditStaffModal = (staff: StaffMember) => {
    setEditingStaff(staff);
    setStaffName(staff.name);
    setStaffOutletId(staff.outletId || 'ALL');
    setStaffRole(staff.role);
    setStaffUsername(staff.username || staff.email.split('@')[0] || '');
    setStaffPassword('');
    setShowStaffModalPass(false);
    setStaffIsActive(staff.isActive !== false);
    setStaffModalError('');
    setStaffPhone(staff.phone || '');
    setStaffAvatar(staff.avatar || '👤');
    setShowStaffModal(true);
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffModalError('');
    const cleanName = staffName.trim();
    const cleanUsername = staffUsername.trim().toLowerCase();
    if (!cleanName || !cleanUsername) {
      setStaffModalError('Staff name and username are required.');
      return;
    }
    if (!editingStaff && staffPassword.length < 4) {
      setStaffModalError('Password must be at least 4 characters.');
      return;
    }
    if (editingStaff && staffPassword.length > 0 && staffPassword.length < 4) {
      setStaffModalError('New password must be at least 4 characters.');
      return;
    }

    setStaffSaving(true);
    const outletPayload = staffOutletId === 'ALL' ? null : staffOutletId;

    const result = editingStaff
      ? await updateConsoleStaffMember(editingStaff.id, {
          name: cleanName,
          username: cleanUsername,
          ...(staffPassword.length > 0 ? { password: staffPassword } : {}),
          role: staffRole,
          outletId: outletPayload,
          phone: staffPhone.trim() || null,
          isActive: staffIsActive,
        })
      : await createConsoleStaffMember({
          name: cleanName,
          username: cleanUsername,
          password: staffPassword,
          role: staffRole,
          outletId: outletPayload,
          phone: staffPhone.trim() || null,
        });

    setStaffSaving(false);
    if (!result.ok || !result.staff) {
      setStaffModalError(result.error || 'Could not save staff credentials.');
      return;
    }

    await loadServerStaffDirectory();
    setShowStaffModal(false);
    setEditingStaff(null);
    setStaffPassword('');
    showToast(
      `✅ ${editingStaff ? 'Updated' : 'Created'} ${result.staff.displayName} (@${result.staff.username} · ${result.staff.role})`,
    );
  };

  const handleDeleteStaff = async (staffId: string, name: string) => {
    if (!confirm(`Deactivate login access for ${name}?`)) return;
    const res = await deactivateConsoleStaffMember(staffId);
    if (!res.ok) {
      showToast(`⚠️ ${res.error || 'Could not deactivate staff member.'}`);
      return;
    }
    await loadServerStaffDirectory();
    showToast(`🗑️ Deactivated staff login for ${name}`);
  };

  // Active Outlet Info
  const currentOutlet = outletsList.find((o) => o.id === selectedOutletId) ?? outletsList[0] ?? OUTLETS[0]!;
  const isBranchPopulated = selectedOutletId === '71ad00a6-d79b-4035-b563-bf9543fcfa86' || selectedOutletId === 'b0000000-0000-0000-0000-000000000001';

  // Live Orders from PostgreSQL
  const [liveDbOrders, setLiveDbOrders] = useState<Order[]>([]);

  const fetchOwnerLiveOrders = async () => {
    if (!getConsoleAuthState()) return;
    try {
      const res = await consoleAuthFetch(
        `/api/v1/console/orders?outlet_id=${encodeURIComponent(selectedOutletId)}`,
      );
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const mapped: Order[] = data.map((d: any) => ({
            id: d.id,
            displayId: 'ORD-#' + d.id.slice(-4).toUpperCase(),
            outletId: d.outlet_id || selectedOutletId,
            tableNumber: d.table_number || 'T04',
            sessionId: d.session_id,
            status: d.status as Order['status'],
            subtotalPaise: d.subtotal_paise,
            taxPaise: d.tax_paise,
            discountPaise: d.discount_paise || 0,
            totalPaise: d.total_paise,
            createdAt: formatOrderDateTime(d.created_at),
            items: (d.items || []).map((it: any) => ({
              id: it.id,
              orderId: d.id,
              itemId: it.menu_item_id,
              name: it.name_snapshot,
              pricePaise: it.unit_price_paise,
              quantity: it.quantity,
              status: it.status,
              notes: it.notes,
              createdAt: formatOrderDateTime(it.created_at || d.created_at),
            })),
            events: [
              {
                id: 'evt-own-' + d.id,
                orderId: d.id,
                previousStatus: 'CREATED',
                newStatus: d.status,
                actorName: 'Guest / Kitchen',
                createdAt: formatOrderDateTime(d.created_at),
              },
            ],
            specialInstructions: d.notes || d.items?.find((i: any) => i.notes)?.notes,
            paymentMethod: 'UPI',
          }));
          setLiveDbOrders(mapped);
        }
      }
    } catch (e) {
      console.warn('Owner live poll error:', e);
    }
  };

  useEffect(() => {
    fetchOwnerLiveOrders();
    const interval = setInterval(fetchOwnerLiveOrders, 4000);
    return () => clearInterval(interval);
  }, [selectedOutletId]);

  // Computed Metrics
  const allOrders: Order[] = liveDbOrders.length > 0
    ? liveDbOrders
    : (isBranchPopulated ? [...currentBranchData.activeOrders, ...currentBranchData.pastOrders] : []);

  const liveRevenuePaise = allOrders.reduce((acc, o) => acc + (o.status !== 'CANCELLED' ? o.totalPaise : 0), 0);
  const totalRevenuePaise = liveRevenuePaise > 0 ? liveRevenuePaise : currentBranchData.payments.reduce((acc, p) => acc + p.amountPaise, 0);
  const totalBilledOrders = allOrders.filter((o) => o.status === 'BILLED' || o.status === 'SERVED').length || currentBranchData.payments.length;
  const aovPaise = totalBilledOrders > 0 ? Math.round(totalRevenuePaise / totalBilledOrders) : 0;

  // Server-backed login handler with real JWT + pre-MFA TOTP verification
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    if (loginStep === 'CREDENTIALS') {
      const res = await loginStaffRemote({
        orgSlug: showOrgSlug ? orgSlug : undefined,
        username: email,
        password,
      });
      setLoginLoading(false);
      if (!res.ok) {
        if (res.error?.toLowerCase().includes('workspace slug')) {
          setShowOrgSlug(true);
        }
        setLoginError(res.error || 'Invalid username or password.');
        return;
      }
      if (res.requiresMfa && res.preMfaToken) {
        setPreMfaToken(res.preMfaToken);
        setTotpCode('');
        setLoginStep('TOTP');
        return;
      }
      if (!res.session || res.session.user.role !== 'OWNER') {
        await logoutStaffRemote();
        setLoginError('Access restricted to verified OWNER accounts.');
        return;
      }
      setIsAuthenticated(true);
      setPassword('');
      return;
    }

    const mfaRes = await verifyStaffMfaRemote({
      preMfaToken,
      code: totpCode,
      orgSlug,
      email,
    });
    setLoginLoading(false);
    if (!mfaRes.ok || !mfaRes.session) {
      setLoginError(mfaRes.error || 'Invalid authenticator or recovery code.');
      return;
    }
    if (mfaRes.session.user.role !== 'OWNER') {
      await logoutStaffRemote();
      setLoginError('Access restricted to verified OWNER accounts.');
      return;
    }
    setIsAuthenticated(true);
    setPassword('');
    setPreMfaToken('');
    setTotpCode('');
  };

  // If not authenticated, render Owner 2FA Login Screen
  if (!isAuthenticated) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'radial-gradient(circle at 50% 20%, #151e33 0%, #090d16 80%)',
        }}
      >
        <div
          style={{
            maxWidth: '420px',
            width: '100%',
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(20px)',
            border: '1.5px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '36px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '26px',
                margin: '0 auto 16px',
                boxShadow: 'var(--shadow-cyan)',
              }}
            >
              👑
            </div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
              Owner Executive Cockpit
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '6px' }}>
              Royal Spice Bistro Group · Multi-tenant Operations
            </p>
          </div>

          {loginError && (
            <div
              style={{
                background: 'rgba(244, 63, 94, 0.15)',
                border: '1px solid var(--accent-rose)',
                color: '#fff',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                marginBottom: '20px',
              }}
            >
              ⚠️ {loginError}
            </div>
          )}

          <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {loginStep === 'CREDENTIALS' ? (
              <>
                <div>
                  <label className="form-label">Owner Username</label>
                  <input
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. owner"
                    required
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Password</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showOwnerPass ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={4}
                      required
                      className="form-input"
                      style={{ paddingRight: '40px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowOwnerPass(!showOwnerPass)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '15px',
                      }}
                    >
                      {showOwnerPass ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => setShowOrgSlug(!showOrgSlug)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {showOrgSlug ? '▾ Hide Workspace Slug' : '▸ Optional: Restaurant Workspace Slug'}
                  </button>
                  {showOrgSlug && (
                    <input
                      type="text"
                      value={orgSlug}
                      onChange={(e) => setOrgSlug(e.target.value)}
                      placeholder="e.g. royal-spice-bistro"
                      className="form-input"
                      style={{ marginTop: '8px' }}
                    />
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="btn-primary"
                  style={{ width: '100%', marginTop: '8px', opacity: loginLoading ? 0.7 : 1 }}
                >
                  {loginLoading ? 'Verifying...' : 'Sign In →'}
                </button>
              </>
            ) : (
              <>
                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                    Enter 6-digit TOTP code from your authenticator app or a recovery code
                  </div>
                </div>
                <div>
                  <input
                    type="text"
                    minLength={6}
                    maxLength={32}
                    placeholder="••••••"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    autoFocus
                    required
                    style={{
                      width: '100%',
                      background: 'var(--bg-main)',
                      border: '2px solid var(--accent-cyan)',
                      borderRadius: '12px',
                      padding: '12px',
                      fontSize: '1.5rem',
                      fontWeight: 900,
                      letterSpacing: '4px',
                      textAlign: 'center',
                      color: 'var(--accent-cyan)',
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="btn-primary"
                  style={{ width: '100%', marginTop: '8px', opacity: loginLoading ? 0.7 : 1 }}
                >
                  {loginLoading ? 'Verifying...' : 'Authenticate & Launch Cockpit'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginStep('CREDENTIALS');
                    setPreMfaToken('');
                    setTotpCode('');
                    setLoginError('');
                  }}
                  style={{ color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer' }}
                >
                  ← Back to credentials
                </button>
              </>
            )}
          </form>

          <div style={{ textAlign: 'center', marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
            <Link
              href="/"
              style={{
                color: 'var(--accent-cyan)',
                fontSize: '0.82rem',
                textDecoration: 'none',
                fontWeight: 700,
              }}
            >
              ← Back to Unified Operations & Staff Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="owner-layout">
      {/* ========================================================
          PERSISTENT EXECUTIVE SIDEBAR NAVIGATION
          ======================================================== */}
      <aside className="owner-sidebar">
        {/* Brand Header */}
        <div style={{ padding: '22px 20px', borderBottom: '1px solid var(--border-light)' }}>
          <Link
            href="/"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: 'inherit' }}
          >
            <div
              style={{
                width: '38px',
                height: '38px',
                background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
                boxShadow: 'var(--shadow-cyan)',
              }}
            >
              👑
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.02em' }}>Royal Spice</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)', fontWeight: 700, letterSpacing: '0.04em' }}>
                EXECUTIVE OWNER
              </div>
            </div>
          </Link>
        </div>

        {/* Quick Floor Switcher Link for Owner */}
        <div style={{ padding: '12px 14px 4px' }}>
          <Link
            href="/staff"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '9px 12px',
              borderRadius: '8px',
              background: 'rgba(6, 182, 212, 0.1)',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              color: 'var(--accent-cyan)',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: '0.82rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>📱</span>
              <span>Floor Workstations</span>
            </div>
            <span style={{ fontSize: '12px' }}>→</span>
          </Link>
        </div>

        {/* Navigation List (9 screens) */}
        <nav className="owner-nav-list">
          {[
            { id: 'DASHBOARD', label: 'Executive Dashboard', icon: '📊' },
            { id: 'ORDERS', label: 'Orders Ledger', icon: '🧾' },
            { id: 'MENU', label: 'Menu Catalog', icon: '🍽️' },
            { id: 'TABLES', label: 'Tables & QR Codes', icon: '🪑' },
            { id: 'PAYMENTS', label: 'Invoices & Settle', icon: '💳' },
            { id: 'LOYALTY', label: 'Coupons & Loyalty', icon: '🎁' },
            { id: 'FEEDBACK', label: 'Customer Reviews', icon: '⭐' },
            { id: 'STAFF', label: 'Staff & Roles', icon: '👥' },
            { id: 'SETTINGS', label: 'Settings & Taxes', icon: '⚙️' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveScreen(item.id as OwnerScreen)}
              className={`owner-nav-btn ${activeScreen === item.id ? 'active' : ''}`}
            >
              <span style={{ fontSize: '18px' }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Footer Identity */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '22px' }}>👔</span>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>Vikram Malhotra</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Group Managing Director</div>
              </div>
            </div>
            <button
              onClick={async () => {
                await logoutStaffRemote();
                setIsAuthenticated(false);
                setLoginStep('CREDENTIALS');
                setPreMfaToken('');
                setTotpCode('');
                setPassword('');
                window.location.href = '/';
              }}
              title="Sign Out to Common Login"
              style={{
                color: '#f87171',
                fontSize: '16px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '6px',
                padding: '4px 8px',
                cursor: 'pointer',
              }}
            >
              🚪
            </button>
          </div>
        </div>
      </aside>

      {/* ========================================================
          MAIN WORKSPACE AREA
          ======================================================== */}
      <div className="owner-main">
        {/* TOP BAR: OUTLET SWITCHER & RANGE SELECTOR */}
        <header className="owner-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Hotel / Branch:</span>
            <select
              value={selectedOutletId}
              onChange={(e) => handleOutletChange(e.target.value)}
              style={{
                background: 'rgba(15, 23, 42, 0.9)',
                color: '#f8fafc',
                border: '1.5px solid var(--accent-cyan)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 14px',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {outletsList.map((outlet) => (
                <option key={outlet.id} value={outlet.id} style={{ background: '#0f172a', color: '#f8fafc' }}>
                  📍 {outlet.name} {outlet.id === '71ad00a6-d79b-4035-b563-bf9543fcfa86' || outlet.id === 'b0000000-0000-0000-0000-000000000001' ? '(Populated & Live DB)' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowAddHotelModal(true)}
              style={{
                background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 14px',
                fontSize: '0.84rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 10px rgba(6, 182, 212, 0.3)',
              }}
            >
              🏨 + Add Hotel / Branch
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px',
                display: 'flex',
                gap: '4px',
              }}
            >
              {(['TODAY', 'YESTERDAY', 'WEEK', 'MONTH'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setDateRange(r)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    background: dateRange === r ? 'var(--accent-cyan)' : 'transparent',
                    color: dateRange === r ? '#000' : 'var(--text-secondary)',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>

            <Link
              href="/staff"
              target="_blank"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(6, 182, 212, 0.15)',
                color: 'var(--accent-cyan)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                padding: '8px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.82rem',
                fontWeight: 800,
                textDecoration: 'none',
              }}
            >
              📱 Launch Staff App ↗
            </Link>

            <button
              type="button"
              onClick={() => {
                setIsAuthenticated(false);
                setLoginStep('CREDENTIALS');
                setPassword('');
                setTotpCode('');
              }}
              title="Lock Cockpit (Require Master Password)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-light)',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🔒 Lock
            </button>
          </div>
        </header>

        {/* CONTENT PANELS */}
        <main className="owner-content">
          {/* Blank Branch Warning Banner */}
          {!isBranchPopulated && (
            <div
              style={{
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: '18px 24px',
                marginBottom: '24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: '#fcd34d',
              }}
            >
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, marginBottom: '4px' }}>
                  Branch Setup Mode: {currentOutlet.name}
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#fef3c7' }}>
                  This outlet has blank child tables in the database. You can quickly onboard it by cloning the menu catalog and tables from Indiranagar Flagship.
                </p>
              </div>
              <button onClick={handleCloneMenu} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.82rem' }}>
                📋 Clone Menu from Flagship
              </button>
            </div>
          )}

          {/* SCREEN 1: EXECUTIVE DASHBOARD */}
          {activeScreen === 'DASHBOARD' && (
            <div>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ fontSize: '1.6rem', fontWeight: 900 }}>Executive Overview</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  Real-time sales telemetry, hourly performance curves, and operational metrics
                </p>
              </div>

              {/* 4 Primary Metric Cards */}
              <div className="owner-metric-grid">
                <div className="owner-metric-card">
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                    GROSS SALES TODAY
                  </span>
                  <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--accent-cyan)', marginTop: '4px' }}>
                    {formatPaise(totalRevenuePaise)}
                  </div>
                  <div style={{ marginTop: '8px' }} className="metric-trend-up">
                    ▲ +14.2% vs yesterday
                  </div>
                </div>

                <div className="owner-metric-card">
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                    COMPLETED ORDERS
                  </span>
                  <div style={{ fontSize: '2rem', fontWeight: 900, color: '#f8fafc', marginTop: '4px' }}>
                    {totalBilledOrders}
                  </div>
                  <div style={{ marginTop: '8px' }} className="metric-trend-up">
                    ▲ 3 active in kitchen now
                  </div>
                </div>

                <div className="owner-metric-card">
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                    AVERAGE ORDER VALUE (AOV)
                  </span>
                  <div style={{ fontSize: '2rem', fontWeight: 900, color: '#10b981', marginTop: '4px' }}>
                    {formatPaise(aovPaise)}
                  </div>
                  <div style={{ marginTop: '8px' }} className="metric-trend-up">
                    ▲ ₹45 higher than target
                  </div>
                </div>

                <div className="owner-metric-card">
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                    TABLE UTILIZATION
                  </span>
                  <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--accent-amber)', marginTop: '4px' }}>
                    {tables.length > 0 ? `${Math.round((3 / tables.length) * 100)}%` : '0%'}
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    3 of {tables.length} tables seated
                  </div>
                </div>
              </div>

              {/* Hourly Sales Performance Curve (From SQL Hourly Rollups) */}
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-md)',
                  padding: '24px',
                  marginBottom: '24px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Hourly Sales Velocity (Today)</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      Peak lunch (13:00-14:00) & peak dinner rush (19:00-21:00)
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <span className="status-chip chip-green">Peak ₹33.5k at 20:00</span>
                  </div>
                </div>

                {currentBranchData.hourlyRollups.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No hourly telemetry for this outlet yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '180px', paddingTop: '20px' }}>
                    {currentBranchData.hourlyRollups.map((h) => {
                      const maxSales = 3350000;
                      const heightPercent = Math.max(12, Math.round((h.grossSalesPaise / maxSales) * 100));
                      const isPeak = h.hour === 20;

                      return (
                        <div key={h.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
                          <div
                            style={{
                              flex: 1,
                              width: '100%',
                              display: 'flex',
                              alignItems: 'flex-end',
                              justifyContent: 'center',
                            }}
                          >
                            <div
                              title={`${h.hourLabel}: ${formatPaise(h.grossSalesPaise)} (${h.orderCount} orders)`}
                              style={{
                                width: '100%',
                                maxWidth: '36px',
                                height: `${heightPercent}%`,
                                background: isPeak
                                  ? 'linear-gradient(180deg, #06b6d4, #3b82f6)'
                                  : 'rgba(255, 255, 255, 0.12)',
                                borderRadius: '4px 4px 0 0',
                                transition: 'all 0.2s ease',
                                cursor: 'pointer',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                            {h.hour}h
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Past 7 Days Daily Performance (From SQL Daily Rollups) */}
              <div className="data-table-container">
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', fontWeight: 800 }}>
                  Past 7 Days Outlet Audit Rollup
                </div>
                {currentBranchData.dailyRollups.length === 0 ? (
                  <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No daily rollups recorded yet for this outlet.
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Order Count</th>
                        <th>Gross Sales</th>
                        <th>Taxes (5% GST)</th>
                        <th>Discounts</th>
                        <th>Net Deposited</th>
                        <th>Tips</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentBranchData.dailyRollups.map((d) => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 700 }}>{d.date}</td>
                          <td>{d.orderCount}</td>
                          <td style={{ fontWeight: 800, color: 'var(--accent-cyan)' }}>{formatPaise(d.grossSalesPaise)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{formatPaise(d.taxPaise)}</td>
                          <td style={{ color: 'var(--accent-amber)' }}>{formatPaise(d.discountPaise)}</td>
                          <td style={{ fontWeight: 800, color: '#10b981' }}>{formatPaise(d.netSalesPaise)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{formatPaise(d.tipPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* SCREEN 2: ORDERS LEDGER */}
          {activeScreen === 'ORDERS' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 900 }}>Orders Master Ledger</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                    Complete audit trail of all customer orders in {currentOutlet.shortName}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="text"
                    placeholder="Search by Order ID, Table, Customer..."
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    style={{
                      background: 'var(--bg-surface)',
                      color: '#fff',
                      border: '1px solid var(--border-light)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 14px',
                      width: '280px',
                      fontSize: '0.85rem',
                    }}
                  />
                  <select
                    value={orderStatusFilter}
                    onChange={(e) => setOrderStatusFilter(e.target.value as any)}
                    style={{
                      background: 'var(--bg-surface)',
                      color: '#fff',
                      border: '1px solid var(--border-light)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 14px',
                      fontSize: '0.85rem',
                    }}
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="BILLED">Billed & Paid</option>
                    <option value="ACTIVE">Active (Kitchen)</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>
              </div>

              <div className="data-table-container">
                {allOrders.length === 0 ? (
                  <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No orders recorded yet for {currentOutlet.name}.
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Table</th>
                        <th>Customer</th>
                        <th>Items Count</th>
                        <th>Subtotal</th>
                        <th>Tax</th>
                        <th>Total</th>
                        <th>Status</th>
                        <th>Placed At</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allOrders
                        .filter((o) => {
                          const matchesSearch =
                            orderSearch === '' ||
                            o.displayId.toLowerCase().includes(orderSearch.toLowerCase()) ||
                            o.tableNumber.toLowerCase().includes(orderSearch.toLowerCase()) ||
                            (o.customerName && o.customerName.toLowerCase().includes(orderSearch.toLowerCase()));
                          if (orderStatusFilter === 'ALL') return matchesSearch;
                          if (orderStatusFilter === 'BILLED') return matchesSearch && o.status === 'BILLED';
                          if (orderStatusFilter === 'ACTIVE') return matchesSearch && (o.status === 'CONFIRMED' || o.status === 'PREPARING' || o.status === 'READY');
                          if (orderStatusFilter === 'CANCELLED') return matchesSearch && o.status === 'CANCELLED';
                          return matchesSearch;
                        })
                        .map((order) => (
                          <tr key={order.id}>
                            <td style={{ fontWeight: 800 }}>{order.displayId}</td>
                            <td>
                              <span style={{ fontWeight: 900, color: 'var(--accent-cyan)' }}>{order.tableNumber}</span>
                            </td>
                            <td>{order.customerName || 'Walk-in Guest'}</td>
                            <td>{order.items.reduce((acc, i) => acc + i.quantity, 0)} items</td>
                            <td style={{ color: 'var(--text-muted)' }}>{formatPaise(order.subtotalPaise)}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{formatPaise(order.taxPaise)}</td>
                            <td style={{ fontWeight: 800, color: '#10b981' }}>{formatPaise(order.totalPaise)}</td>
                            <td>
                              <span
                                className={`status-chip ${
                                  order.status === 'BILLED'
                                    ? 'chip-green'
                                    : order.status === 'PREPARING' || order.status === 'CONFIRMED'
                                    ? 'chip-amber'
                                    : order.status === 'READY'
                                    ? 'chip-blue'
                                    : 'chip-red'
                                }`}
                              >
                                {order.status}
                              </span>
                            </td>
                            <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{order.createdAt}</td>
                            <td>
                              <button
                                onClick={() => setSelectedOrderDrawer(order)}
                                style={{
                                  background: 'rgba(6, 182, 212, 0.15)',
                                  color: 'var(--accent-cyan)',
                                  border: '1px solid rgba(6, 182, 212, 0.3)',
                                  padding: '4px 10px',
                                  borderRadius: '4px',
                                  fontSize: '0.78rem',
                                  fontWeight: 700,
                                }}
                              >
                                Audit Detail →
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* SCREEN 3: MENU CATALOG (PostgreSQL + Food Photo Editor) */}
          {activeScreen === 'MENU' && (
            <MenuCatalogManager
              outletId={selectedOutletId}
              outletName={currentOutlet.shortName || currentOutlet.name}
              onToast={showToast}
            />
          )}

          {/* SCREEN 4: TABLES & QR CODES */}
          {activeScreen === 'TABLES' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 900 }}>Tables & Cryptographic QR Codes</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                    Generate print-ready QR table stands with token versioning for security
                  </p>
                </div>

                <button
                  onClick={() => setShowQrSheetModal(true)}
                  className="btn-primary"
                >
                  🖨 Print QR Table Stands Sheet
                </button>
              </div>

              <div className="data-table-container">
                {tables.length === 0 ? (
                  <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No tables configured for this branch yet.
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Table Number</th>
                        <th>Section</th>
                        <th>Capacity</th>
                        <th>QR Token Version</th>
                        <th>Active Session</th>
                        <th>Security Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tables.map((t) => {
                        const session = currentBranchData.sessions.find((s) => s.tableId === t.id && s.status === 'OPEN');
                        return (
                          <tr key={t.id}>
                            <td style={{ fontWeight: 900, color: 'var(--accent-cyan)', fontSize: '1.1rem' }}>
                              {t.number}
                            </td>
                            <td>{t.section}</td>
                            <td>{t.capacity} Guests</td>
                            <td>
                              <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>v{t.qrTokenVersion}</span>
                            </td>
                            <td>
                              {session ? (
                                <span className="status-chip chip-green">Active ({session.guestCount} pax)</span>
                              ) : (
                                <span className="status-chip chip-purple">Vacant</span>
                              )}
                            </td>
                            <td style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => {
                                  setQrModalTable(t);
                                }}
                                style={{
                                  background: 'rgba(6, 182, 212, 0.15)',
                                  color: 'var(--accent-cyan)',
                                  border: '1px solid rgba(6, 182, 212, 0.3)',
                                  padding: '4px 10px',
                                  borderRadius: '4px',
                                  fontSize: '0.78rem',
                                  fontWeight: 700,
                                }}
                              >
                                🔍 Preview Stand
                              </button>
                              <button
                                onClick={() => {
                                  // Invalidate stolen QR code by bumping token version
                                  setTables((prev) =>
                                    prev.map((item) =>
                                      item.id === t.id ? { ...item, qrTokenVersion: item.qrTokenVersion + 1 } : item
                                    )
                                  );
                                }}
                                style={{
                                  background: 'rgba(244, 63, 94, 0.15)',
                                  color: 'var(--accent-rose)',
                                  border: '1px solid rgba(244, 63, 94, 0.3)',
                                  padding: '4px 10px',
                                  borderRadius: '4px',
                                  fontSize: '0.78rem',
                                  fontWeight: 700,
                                }}
                              >
                                🔄 Invalidate & Regen Token
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* SCREEN 5: PAYMENTS & GST INVOICES */}
          {activeScreen === 'PAYMENTS' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 900 }}>Invoices & Financial Settlement</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                    Gapless sequential GST tax invoices under Karnataka GSTIN {ORGANIZATION.gstin}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setPaymentsSubTab('PAYMENTS')}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      background: paymentsSubTab === 'PAYMENTS' ? 'var(--accent-cyan)' : 'var(--bg-surface)',
                      color: paymentsSubTab === 'PAYMENTS' ? '#000' : 'var(--text-secondary)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    Payments List ({currentBranchData.payments.length})
                  </button>
                  <button
                    onClick={() => setPaymentsSubTab('INVOICES')}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      background: paymentsSubTab === 'INVOICES' ? 'var(--accent-cyan)' : 'var(--bg-surface)',
                      color: paymentsSubTab === 'INVOICES' ? '#000' : 'var(--text-secondary)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    Tax Invoices ({currentBranchData.invoices.length})
                  </button>
                </div>
              </div>

              {paymentsSubTab === 'PAYMENTS' ? (
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Payment ID</th>
                        <th>Order</th>
                        <th>Table</th>
                        <th>Customer</th>
                        <th>Method</th>
                        <th>Amount</th>
                        <th>Gateway MDR</th>
                        <th>Net Deposited</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentBranchData.payments.map((p) => (
                        <tr key={p.id}>
                          <td style={{ fontFamily: 'monospace' }}>{p.id.slice(0, 10)}...</td>
                          <td style={{ fontWeight: 700 }}>{p.displayId}</td>
                          <td>
                            <span style={{ fontWeight: 800, color: 'var(--accent-cyan)' }}>{p.tableNumber}</span>
                          </td>
                          <td>{p.customerName}</td>
                          <td>
                            <span className="status-chip chip-blue">{p.method}</span>
                          </td>
                          <td style={{ fontWeight: 800, color: '#10b981' }}>{formatPaise(p.amountPaise)}</td>
                          <td style={{ color: 'var(--accent-rose)' }}>{formatPaise(p.gatewayFeePaise)}</td>
                          <td style={{ fontWeight: 800 }}>{formatPaise(p.netDepositedPaise)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{p.timestamp}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Invoice Number</th>
                        <th>Buyer Name</th>
                        <th>Subtotal</th>
                        <th>CGST (2.5%)</th>
                        <th>SGST (2.5%)</th>
                        <th>Total Paid</th>
                        <th>Issued At</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentBranchData.invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td style={{ fontWeight: 800, color: 'var(--accent-cyan)' }}>{inv.invoiceNumber}</td>
                          <td>{inv.buyerName}</td>
                          <td>{formatPaise(inv.subtotalPaise)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{formatPaise(inv.cgstPaise)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{formatPaise(inv.sgstPaise)}</td>
                          <td style={{ fontWeight: 800, color: '#10b981' }}>{formatPaise(inv.totalPaise)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{inv.issuedAt}</td>
                          <td>
                            <button
                              onClick={() => setSelectedInvoiceModal(inv)}
                              style={{
                                background: 'rgba(255, 255, 255, 0.06)',
                                border: '1px solid var(--border-light)',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                fontSize: '0.78rem',
                                color: '#fff',
                              }}
                            >
                              🖨 Print Invoice
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* SCREEN 6: COUPONS & LOYALTY */}
          {activeScreen === 'LOYALTY' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 900 }}>Loyalty, Coupons & Referral Ledger</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                    Strict validation rules, maximum discount caps, and zero review-gating compliance
                  </p>
                </div>

                <button onClick={() => setShowCreateCouponModal(true)} className="btn-primary">
                  + Create Promotional Coupon
                </button>
              </div>

              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Coupon Code</th>
                      <th>Discount Type</th>
                      <th>Value</th>
                      <th>Max Cap</th>
                      <th>Min Spend</th>
                      <th>Redemptions</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coupons.map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 900, color: 'var(--accent-cyan)', letterSpacing: '1px' }}>
                          {c.code}
                        </td>
                        <td>{c.discountType}</td>
                        <td style={{ fontWeight: 800 }}>
                          {c.discountType === 'FLAT' ? formatPaise(c.discountValue) : `${c.discountValue}% OFF`}
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>{formatPaise(c.maxDiscountPaise)}</td>
                        <td>{formatPaise(c.minOrderPaise)}</td>
                        <td>{c.usedCount} used</td>
                        <td>
                          <span className="status-chip chip-green">ACTIVE</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SCREEN 7: CUSTOMER FEEDBACK & ZERO REVIEW INCENTIVE POLICY */}
          {activeScreen === 'FEEDBACK' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 900 }}>Guest Feedback & Quality Audit</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                    Private post-dining sentiment and resolution tracking
                  </p>
                </div>
              </div>

              {/* Compliance Notice */}
              <div
                style={{
                  background: 'rgba(6, 182, 212, 0.1)',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 18px',
                  marginBottom: '20px',
                  fontSize: '0.82rem',
                  color: 'var(--accent-cyan)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <span>🛡️</span>
                <span>
                  <strong>Compliance Enforced (ARCH §19 & AGENTS §2 Rule 10):</strong> No discounts, points or rewards are conditioned on public Google reviews. In-house feedback is kept private for hospitality recovery.
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {feedbackList.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-card)',
                      borderRadius: 'var(--radius-md)',
                      padding: '18px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1.1rem', color: '#f59e0b' }}>
                          {'★'.repeat(f.rating) + '☆'.repeat(5 - f.rating)}
                        </span>
                        <strong>{f.customerName}</strong>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Table {f.tableNumber} · {f.createdAt}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {f.tags.map((tag) => (
                          <span key={tag} className="status-chip chip-purple">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    <p style={{ fontSize: '0.92rem', color: '#f8fafc', marginBottom: '12px' }}>
                      &quot;{f.comments}&quot;
                    </p>

                    {f.resolutionNotes ? (
                      <div
                        style={{
                          background: 'rgba(16, 185, 129, 0.1)',
                          borderLeft: '3px solid #10b981',
                          padding: '8px 12px',
                          borderRadius: '0 6px 6px 0',
                          fontSize: '0.8rem',
                          color: '#d1fae5',
                        }}
                      >
                        <strong>Manager Resolution Note:</strong> {f.resolutionNotes}
                      </div>
                    ) : (
                      <button
                        onClick={() => setSelectedFeedbackDrawer(f)}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          color: 'var(--accent-cyan)',
                          border: '1px solid var(--border-light)',
                          padding: '6px 12px',
                          borderRadius: '4px',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                        }}
                      >
                        + Add Manager Resolution
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SCREEN 8: STAFF & ROLES (OWNER ASSIGNED CREDENTIALS) */}
          {activeScreen === 'STAFF' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 900 }}>Staff & Role-Based Access</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                    Assign hotels, login credentials, passwords, and terminal PINs set by the Owner
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <select
                    value={staffFilterOutlet}
                    onChange={(e) => setStaffFilterOutlet(e.target.value)}
                    style={{
                      background: 'rgba(15, 23, 42, 0.85)',
                      color: '#f8fafc',
                      border: '1px solid var(--border-light)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 12px',
                      fontSize: '0.84rem',
                      fontWeight: 700,
                    }}
                  >
                    <option value="ALL">🏢 All Hotels & Outlets ({staffList.length} staff)</option>
                    {outletsList.map((o) => (
                      <option key={o.id} value={o.id}>
                        📍 {o.shortName || o.name} ({staffList.filter((s) => s.outletId === o.id).length})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={openAddStaffModal}
                    className="btn-primary"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '9px 16px',
                      fontSize: '0.88rem',
                      fontWeight: 800,
                    }}
                  >
                    ➕ Add Staff Member
                  </button>
                </div>
              </div>

              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Staff Member</th>
                      <th>Role</th>
                      <th>Hotel / Branch</th>
                      <th>Email / Directory</th>
                      <th>Auth Security</th>
                      <th>Phone</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffList
                      .filter((s) => {
                        if (staffFilterOutlet === 'ALL') return true;
                        return s.outletId === staffFilterOutlet || s.outletId === null;
                      })
                      .map((s) => {
                        const assignedOutlet = outletsList.find((o) => o.id === s.outletId);
                        return (
                          <tr key={s.id}>
                            <td style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '26px' }}>{s.avatar || '👤'}</span>
                              <div>
                                <div style={{ fontWeight: 800 }}>{s.name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)' }}>
                                  @{s.username || s.email.split('@')[0]}
                                </div>
                              </div>
                            </td>
                            <td>
                              <span
                                className={`status-chip ${
                                  s.role === 'KITCHEN'
                                    ? 'chip-yellow'
                                    : s.role === 'CAPTAIN'
                                    ? 'chip-blue'
                                    : s.role === 'CASHIER'
                                    ? 'chip-green'
                                    : 'chip-purple'
                                }`}
                              >
                                {s.role}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                                {assignedOutlet ? `📍 ${assignedOutlet.shortName || assignedOutlet.name}` : '🌐 All Outlets'}
                              </span>
                            </td>
                            <td>
                              <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontFamily: 'monospace' }}>
                                {s.email}
                              </div>
                            </td>
                            <td>
                              <span
                                style={{
                                  background: 'rgba(6, 182, 212, 0.14)',
                                  color: 'var(--accent-cyan)',
                                  fontWeight: 800,
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.78rem',
                                }}
                              >
                                🔑 Username + Password
                              </span>
                            </td>
                            <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{s.phone || '—'}</td>
                            <td>
                              <span className={`status-chip ${s.isActive ? 'chip-green' : 'chip-yellow'}`}>
                                {s.isActive ? 'ACTIVE' : 'DISABLED'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: '6px' }}>
                                <button
                                  onClick={() => openEditStaffModal(s)}
                                  className="btn-secondary"
                                  style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                                >
                                  ✏️ Edit
                                </button>
                                {s.role !== 'OWNER' && (
                                  <button
                                    onClick={() => handleDeleteStaff(s.id, s.name)}
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
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SCREEN 9: SETTINGS & OWNER AUTHORIZATION */}
          {activeScreen === 'SETTINGS' && (
            <div style={{ maxWidth: '840px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <h2 style={{ fontSize: '1.6rem', fontWeight: 900 }}>Restaurant Entity & Security</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  Owner master authorization password, statutory GSTIN, legal registrations, and branch configuration
                </p>
              </div>

              {/* CARD 1: OWNER AUTHORIZATION & MASTER PASSWORD */}
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1.5px solid rgba(6, 182, 212, 0.4)',
                  borderRadius: 'var(--radius-md)',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  boxShadow: '0 8px 24px rgba(6, 182, 212, 0.1)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      👑 Owner Master Authorization
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '2px' }}>
                      Only the owner holds this password. Protects the Executive Cockpit from unauthorized access.
                    </p>
                  </div>
                  <span
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: '#10b981',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                    }}
                  >
                    PROTECTED
                  </span>
                </div>

                <div
                  style={{
                    padding: '14px 16px',
                    background: 'rgba(16, 185, 129, 0.08)',
                    borderRadius: '10px',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    fontSize: '0.85rem',
                    color: '#d1fae5',
                  }}
                >
                  🔐 Owner & Manager authentication uses server-verified Argon2id passwords + AES-256-GCM encrypted TOTP MFA. Credentials are never stored in browser storage.
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '8px',
                    border: '1px solid var(--border-light)',
                    fontSize: '0.82rem',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Test authorization locking now:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAuthenticated(false);
                      setLoginStep('CREDENTIALS');
                      setPassword('');
                      setTotpCode('');
                    }}
                    style={{
                      background: 'rgba(239, 68, 68, 0.15)',
                      color: '#f87171',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    🔒 Lock Cockpit
                  </button>
                </div>
              </div>

              {/* CARD 2: RESTAURANT & GSTIN DETAILS */}
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-md)',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '18px',
                }}
              >
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '4px' }}>
                    Statutory & Organization Details
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                    Government tax registrations and physical branch location
                  </p>
                </div>

                <div>
                  <label className="form-label">Legal Organization Name</label>
                  <input type="text" readOnly value={ORGANIZATION.name} className="form-input" />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label className="form-label">Seller GSTIN (Karnataka)</label>
                    <input type="text" readOnly value={ORGANIZATION.gstin} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">FSSAI Food Safety License</label>
                    <input type="text" readOnly value={ORGANIZATION.fssai} className="form-input" />
                  </div>
                </div>

                <div>
                  <label className="form-label">Active Hotel / Outlet Address</label>
                  <input type="text" readOnly value={currentOutlet.address} className="form-input" />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* PRINTABLE GST TAX INVOICE MODAL */}
      {selectedInvoiceModal && (
        <div className="modal-overlay" onClick={() => setSelectedInvoiceModal(null)}>
          <div
            className="modal-content"
            style={{ maxWidth: '600px', background: '#fff', color: '#000', padding: '30px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: '16px', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#000' }}>{ORGANIZATION.name}</h2>
              <div style={{ fontSize: '0.8rem' }}>{currentOutlet.address}</div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>GSTIN: {selectedInvoiceModal.sellerGstin}</div>
              <div style={{ fontSize: '0.75rem', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 800 }}>
                TAX INVOICE (B2C)
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '14px' }}>
              <div>
                <div><strong>Invoice No:</strong> {selectedInvoiceModal.invoiceNumber}</div>
                <div><strong>Date & Time:</strong> {selectedInvoiceModal.issuedAt}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div><strong>Customer:</strong> {selectedInvoiceModal.buyerName}</div>
                <div><strong>Table:</strong> {selectedInvoiceModal.tableNumber}</div>
                <div><strong>Payment:</strong> {selectedInvoiceModal.paymentMethod}</div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #ccc', borderBottom: '1px solid #ccc', padding: '12px 0', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                <span>Subtotal (Net of Taxes):</span>
                <span>{formatPaise(selectedInvoiceModal.subtotalPaise)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                <span>Central GST (CGST @ 2.5%):</span>
                <span>{formatPaise(selectedInvoiceModal.cgstPaise)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span>State GST (SGST @ 2.5%):</span>
                <span>{formatPaise(selectedInvoiceModal.sgstPaise)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 900, marginBottom: '24px' }}>
              <span>Total Paid:</span>
              <span>{formatPaise(selectedInvoiceModal.totalPaise)}</span>
            </div>

            <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#666', borderTop: '1px solid #eee', paddingTop: '12px' }}>
              Thank you for dining with Royal Spice Bistro! We look forward to serving you again.
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button
                onClick={() => window.print()}
                style={{
                  flex: 1,
                  background: '#000',
                  color: '#fff',
                  padding: '10px',
                  borderRadius: '6px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                🖨 Print Official Invoice
              </button>
              <button
                onClick={() => setSelectedInvoiceModal(null)}
                style={{
                  background: '#eee',
                  color: '#000',
                  padding: '10px 16px',
                  borderRadius: '6px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR STAND PREVIEW MODAL */}
      {qrModalTable && (
        <div className="modal-overlay" onClick={() => setQrModalTable(null)}>
          <div
            className="modal-content"
            style={{ maxWidth: '440px', textAlign: 'center', background: '#0f172a', border: '1px solid var(--accent-cyan)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '1.3rem', fontWeight: 900, marginBottom: '4px' }}>
              Table Stand: {qrModalTable.number}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: '18px' }}>
              {qrModalTable.section} · Token v{qrModalTable.qrTokenVersion}
            </p>

            {/* Stand Graphic */}
            <div
              style={{
                background: '#fff',
                padding: '24px',
                borderRadius: '16px',
                display: 'inline-block',
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                color: '#000',
                marginBottom: '20px',
              }}
            >
              <div style={{ fontWeight: 900, fontSize: '1rem', marginBottom: '4px' }}>ROYAL SPICE BISTRO</div>
              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '12px' }}>Scan to View Menu & Order</div>
              <div
                style={{
                  width: '180px',
                  height: '180px',
                  background: '#000',
                  margin: '0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 800,
                  borderRadius: '8px',
                }}
              >
                [ QR CODE: TABLE {qrModalTable.number} ]
              </div>
              <div style={{ fontWeight: 900, fontSize: '1.4rem', marginTop: '12px' }}>
                TABLE {qrModalTable.number}
              </div>
            </div>

            <button onClick={() => setQrModalTable(null)} className="btn-secondary" style={{ width: '100%' }}>
              Close Preview
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          ADD NEW HOTEL / RESTAURANT MODAL
          ======================================================== */}
      {showAddHotelModal && (
        <div className="modal-overlay" onClick={() => setShowAddHotelModal(false)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>🏨 Add New Hotel / Restaurant</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                  Add a new restaurant outlet to your DineFlow organization
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddHotelModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateHotel} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="form-label">Hotel / Restaurant Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Royal Spice Heritage Palace"
                  value={hotelName}
                  onChange={(e) => setHotelName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Display Short Name</label>
                <input
                  type="text"
                  placeholder="e.g. Heritage Palace"
                  value={hotelShortName}
                  onChange={(e) => setHotelShortName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Address & Location</label>
                <input
                  type="text"
                  placeholder="e.g. 80ft Road, 4th Block, Koramangala, Bengaluru"
                  value={hotelAddress}
                  onChange={(e) => setHotelAddress(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Contact Phone</label>
                <input
                  type="text"
                  placeholder="e.g. +91 80 4123 5678"
                  value={hotelPhone}
                  onChange={(e) => setHotelPhone(e.target.value)}
                  className="form-input"
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '12px' }}>
                  🏨 Create Hotel & Initialize Tables
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddHotelModal(false)}
                  className="btn-secondary"
                  style={{ padding: '12px 18px' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          ADD / EDIT STAFF CREDENTIALS MODAL (OWNER SET)
          ======================================================== */}
      {showStaffModal && (
        <div className="modal-overlay" onClick={() => setShowStaffModal(false)}>
          <div className="modal-content" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>
                  {editingStaff ? '✏️ Edit Staff Credentials' : '➕ Add Staff Member'}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                  Only the Owner assigns or changes staff role, username, and password
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStaffModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {staffModalError && (
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
                ⚠️ {staffModalError}
              </div>
            )}

            <form onSubmit={handleSaveStaff} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px', alignItems: 'center' }}>
                <div>
                  <label className="form-label">Avatar</label>
                  <select
                    value={staffAvatar}
                    onChange={(e) => setStaffAvatar(e.target.value)}
                    style={{
                      background: 'rgba(15, 23, 42, 0.9)',
                      color: '#fff',
                      fontSize: '22px',
                      padding: '8px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    {['👨‍💼', '👨‍🍳', '👩‍💼', '🧑‍🍳', '🤵', '👤', '👩‍🍳', '👮'].map((em) => (
                      <option key={em} value={em}>
                        {em}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Staff Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rajesh Kumar"
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label">Hotel / Restaurant Assignment</label>
                  <select
                    value={staffOutletId}
                    onChange={(e) => setStaffOutletId(e.target.value)}
                    className="form-input"
                  >
                    <option value="ALL">🌐 All Outlets (Org-Wide)</option>
                    {outletsList.map((o) => (
                      <option key={o.id} value={o.id}>
                        📍 {o.shortName || o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Assigned Role *</label>
                  <select
                    value={staffRole}
                    onChange={(e) => setStaffRole(e.target.value as StaffMember['role'])}
                    className="form-input"
                  >
                    <option value="CAPTAIN">👨‍💼 Captain</option>
                    <option value="KITCHEN">👨‍🍳 Kitchen Chef / Cook</option>
                    <option value="CASHIER">👩‍💼 Cashier / POS</option>
                    <option value="WAITER">🤵 Waiter / Server</option>
                    <option value="MANAGER">👔 Branch Manager</option>
                    <option value="OWNER">👑 Owner</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label">Login Username *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. rajesh1"
                    value={staffUsername}
                    onChange={(e) => setStaffUsername(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">
                    {editingStaff ? 'New Password (optional)' : 'Password *'}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showStaffModalPass ? 'text' : 'password'}
                      required={!editingStaff}
                      minLength={4}
                      placeholder={editingStaff ? 'Blank = keep existing' : 'Min 4 characters'}
                      value={staffPassword}
                      onChange={(e) => setStaffPassword(e.target.value)}
                      className="form-input"
                      style={{ paddingRight: '38px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowStaffModalPass(!showStaffModalPass)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                      }}
                    >
                      {showStaffModalPass ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
              </div>

              {editingStaff && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', color: '#cbd5e1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={staffIsActive}
                    onChange={(e) => setStaffIsActive(e.target.checked)}
                  />
                  Account Active (uncheck to disable staff login)
                </label>
              )}

              <div>
                <label className="form-label">Phone Number (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. +91 98860 12345"
                  value={staffPhone}
                  onChange={(e) => setStaffPhone(e.target.value)}
                  className="form-input"
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  type="submit"
                  disabled={staffSaving}
                  className="btn-primary"
                  style={{ flex: 1, padding: '12px', opacity: staffSaving ? 0.7 : 1 }}
                >
                  {staffSaving ? 'Saving...' : '💾 Save Staff Credentials'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowStaffModal(false)}
                  className="btn-secondary"
                  style={{ padding: '12px 18px' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          TOAST POPUP NOTIFICATION
          ======================================================== */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1.5px solid var(--accent-cyan)',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: '10px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
            fontSize: '0.9rem',
            fontWeight: 700,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
