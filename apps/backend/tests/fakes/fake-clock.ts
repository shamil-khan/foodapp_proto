import type { ClockPort } from '@/loyalty/application/loyalty-ports';

export class FakeClock implements ClockPort {
  private current: Date;

  constructor(initial: Date | string = '2026-11-23T12:00:00.000Z') {
    this.current = initial instanceof Date ? new Date(initial.getTime()) : new Date(initial);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 86_400_000);
  }
}
