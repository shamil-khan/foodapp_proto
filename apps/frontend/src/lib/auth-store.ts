import { appStorage } from './storage';

export const ActorSource = {
  POS_STAFF: 'POS_STAFF',
  GLOBAL_USER: 'GLOBAL_USER',
} as const;
export type ActorSource = (typeof ActorSource)[keyof typeof ActorSource];

export const PosStaffRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  ORDER_TAKER: 'ORDER_TAKER',
} as const;
export type PosStaffRole = (typeof PosStaffRole)[keyof typeof PosStaffRole];

export const TerminalMode = {
  POS: 'POS',
  KDS: 'KDS',
  KIOSK: 'KIOSK',
} as const;
export type TerminalMode = (typeof TerminalMode)[keyof typeof TerminalMode];

export interface AuthSession {
  token: string;
  actorSource: ActorSource;
  actorId: string;
  email: string;
  role: string;
  restaurantId?: string;
}

export interface TerminalLock {
  isLocked: true;
  restaurantId: string;
  mode: TerminalMode;
}

const SESSION_KEY = 'fapp_auth_session';
const TERMINAL_LOCK_KEY = 'fapp_terminal_lock';

let memorySession: AuthSession | null = null;
let memoryTerminalLock: TerminalLock | null = null;

export const authStore = {
  async hydrate(): Promise<{
    session: AuthSession | null;
    terminalLock: TerminalLock | null;
  }> {
    const [rawSession, rawLock] = await Promise.all([
      appStorage.getItem(SESSION_KEY),
      appStorage.getItem(TERMINAL_LOCK_KEY),
    ]);

    memorySession = rawSession ? (JSON.parse(rawSession) as AuthSession) : null;
    memoryTerminalLock = rawLock ? (JSON.parse(rawLock) as TerminalLock) : null;

    return {
      session: memorySession,
      terminalLock: memoryTerminalLock,
    };
  },

  getSession(): AuthSession | null {
    return memorySession;
  },

  getTerminalLock(): TerminalLock | null {
    return memoryTerminalLock;
  },

  async setSession(session: AuthSession): Promise<void> {
    memorySession = session;
    await appStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },

  async clearSession(): Promise<void> {
    memorySession = null;
    await appStorage.removeItem(SESSION_KEY);
  },

  async lockTerminal(restaurantId: string, mode: TerminalMode = TerminalMode.POS): Promise<void> {
    const lock: TerminalLock = {
      isLocked: true,
      restaurantId,
      mode,
    };
    memoryTerminalLock = lock;
    await appStorage.setItem(TERMINAL_LOCK_KEY, JSON.stringify(lock));
  },

  async unlockTerminal(): Promise<void> {
    memoryTerminalLock = null;
    await appStorage.removeItem(TERMINAL_LOCK_KEY);
    await this.clearSession();
  },
};
