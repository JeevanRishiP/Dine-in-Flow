import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConfig } from '../../config/config.js';

export interface StaffJwtPayload {
  sub: string;       // staff_user.id
  org: string;       // org.id
  role: string;      // OWNER | MANAGER | CASHIER | KITCHEN | WAITER
  outletId?: string; // scoped outlet if membership is outlet-level
  type: 'staff_access';
}

export interface CustomerJwtPayload {
  sub: string;       // customer.id
  org: string;       // org.id
  phone: string;     // E.164 phone (verified)
  type: 'customer_access';
}

export interface GuestSessionJwtPayload {
  sub: string;             // table_session.id
  org: string;             // org.id
  outlet: string;          // outlet.id
  table: string;           // table.id
  sessionId: string;       // table_session.id
  customerId?: string;     // verified account customer id (when signed in)
  tempCustomerId?: string; // persistent temporary guest customer id (until tables cleaned)
  type: 'guest_session';
}

export interface TempCustomerJwtPayload {
  sub: string; // temp_customers.id
  org: string;
  outlet: string;
  purpose: 'temp_customer';
  type: 'temp_customer';
}

export interface PreMfaJwtPayload {
  sub: string;       // staff_user.id
  org: string;       // org.id
  role: string;
  purpose: 'pre_mfa';
  type: 'pre_mfa';
}

export interface GooglePreRegJwtPayload {
  sub: string;       // google_sub
  org: string;       // org.id
  email: string;     // verified Google email
  name?: string;
  purpose: 'google_prereg';
  type: 'google_prereg';
}

export type JwtPayload = StaffJwtPayload | CustomerJwtPayload | GuestSessionJwtPayload;

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  /**
   * Issue a short-lived access token (15 min).
   * Reference: ARCH §12 — "JWT access tokens, 15 min TTL"
   */
  signAccessToken(payload: StaffJwtPayload | CustomerJwtPayload): string {
    const config = getConfig();
    return this.jwtService.sign(payload, {
      secret: config.JWT_SECRET,
      expiresIn: '15m',
    });
  }

  /**
   * Issue a guest table-session token (4h TTL matching session lifetime).
   * Reference: ARCH §9, §12
   */
  signGuestSessionToken(payload: GuestSessionJwtPayload): string {
    const config = getConfig();
    return this.jwtService.sign(payload, {
      secret: config.JWT_SECRET,
      expiresIn: '4h',
    });
  }

  /**
   * Issue a domain-separated pre-MFA token (5m TTL) used solely for step-2 TOTP verification.
   * Cryptographically distinct from access tokens so it cannot access protected APIs.
   */
  signPreMfaToken(payload: Omit<PreMfaJwtPayload, 'purpose' | 'type'>): string {
    const config = getConfig();
    return this.jwtService.sign(
      { ...payload, purpose: 'pre_mfa', type: 'pre_mfa' },
      {
        secret: `${config.JWT_SECRET}:pre_mfa`,
        expiresIn: '5m',
      },
    );
  }

  /**
   * Verify a pre-MFA token issued by staff login().
   */
  verifyPreMfaToken(token: string): PreMfaJwtPayload | null {
    const config = getConfig();
    try {
      const decoded = this.jwtService.verify<PreMfaJwtPayload>(token, {
        secret: `${config.JWT_SECRET}:pre_mfa`,
      });
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        decoded.type !== 'pre_mfa' ||
        decoded.purpose !== 'pre_mfa' ||
        !decoded.sub ||
        !decoded.org
      ) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Issue a short-lived token (10m TTL) binding a Google-verified email + googleSub
   * to complete phone-first registration via WhatsApp OTP.
   */
  signGooglePreRegToken(payload: Omit<GooglePreRegJwtPayload, 'purpose' | 'type'>): string {
    const config = getConfig();
    return this.jwtService.sign(
      { ...payload, purpose: 'google_prereg', type: 'google_prereg' },
      {
        secret: `${config.JWT_SECRET}:google_prereg`,
        expiresIn: '10m',
      },
    );
  }

  verifyGooglePreRegToken(token: string): GooglePreRegJwtPayload | null {
    const config = getConfig();
    try {
      const decoded = this.jwtService.verify<GooglePreRegJwtPayload>(token, {
        secret: `${config.JWT_SECRET}:google_prereg`,
      });
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        decoded.type !== 'google_prereg' ||
        decoded.purpose !== 'google_prereg' ||
        !decoded.sub ||
        !decoded.org ||
        !decoded.email
      ) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Issue a cookie token (12h TTL) binding an anonymous browser to its server-side
   * temporary customer ID across refreshes, multi-table orders, and redirects.
   */
  signTempCustomerToken(payload: Omit<TempCustomerJwtPayload, 'purpose' | 'type'>): string {
    const config = getConfig();
    return this.jwtService.sign(
      { ...payload, purpose: 'temp_customer', type: 'temp_customer' },
      {
        secret: `${config.JWT_SECRET}:temp_customer`,
        expiresIn: '12h',
      },
    );
  }

  verifyTempCustomerToken(token: string): TempCustomerJwtPayload | null {
    const config = getConfig();
    try {
      const decoded = this.jwtService.verify<TempCustomerJwtPayload>(token, {
        secret: `${config.JWT_SECRET}:temp_customer`,
      });
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        decoded.type !== 'temp_customer' ||
        decoded.purpose !== 'temp_customer' ||
        !decoded.sub ||
        !decoded.org ||
        !decoded.outlet
      ) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Verify and decode an access token.
   * Rejects foreign or intermediate token types (e.g. pre_mfa).
   */
  verifyAccessToken(token: string): JwtPayload | null {
    const config = getConfig();
    try {
      const decoded = this.jwtService.verify<JwtPayload>(token, { secret: config.JWT_SECRET });
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        (decoded.type !== 'staff_access' &&
          decoded.type !== 'customer_access' &&
          decoded.type !== 'guest_session')
      ) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }
}
