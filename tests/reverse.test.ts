import { describe, expect, it } from 'vitest';
import { reversePaymentSchema } from '../src/application/reverse';
import { sanitizeCsvCell, toCsv } from '../src/domain/reconciliation';

describe('Phase 6 Unit Tests: Reverse Payment Schema & CSV Sanitization', () => {
  describe('reversePaymentSchema', () => {
    it('accepts valid repayment reversal payload', () => {
      const parsed = reversePaymentSchema.parse({
        paymentId: '11111111-1111-4111-8111-111111111111',
        reversalDate: '2026-04-15',
        reason: 'Duplicate bank entry entered by mistake',
        idempotencyKey: 'cmd-rev-001',
      });
      expect(parsed.paymentId).toBe('11111111-1111-4111-8111-111111111111');
      expect(parsed.reversalDate).toBe('2026-04-15');
      expect(parsed.reason).toBe('Duplicate bank entry entered by mistake');
      expect(parsed.idempotencyKey).toBe('cmd-rev-001');
    });

    it('rejects invalid reversalDate format or calendar date', () => {
      expect(() =>
        reversePaymentSchema.parse({
          paymentId: 'a0000000-0000-0000-0000-000000000001',
          reversalDate: '15-04-2026',
          reason: 'Duplicate payment entry',
          idempotencyKey: 'cmd-rev-002',
        }),
      ).toThrow();
    });

    it('rejects reason shorter than 5 characters or empty', () => {
      expect(() =>
        reversePaymentSchema.parse({
          paymentId: 'a0000000-0000-0000-0000-000000000001',
          reversalDate: '2026-04-15',
          reason: 'bad',
          idempotencyKey: 'cmd-rev-003',
        }),
      ).toThrow();

      expect(() =>
        reversePaymentSchema.parse({
          paymentId: 'a0000000-0000-0000-0000-000000000001',
          reversalDate: '2026-04-15',
          reason: '   ',
          idempotencyKey: 'cmd-rev-003',
        }),
      ).toThrow();
    });

    it('rejects invalid or missing paymentId', () => {
      expect(() =>
        reversePaymentSchema.parse({
          paymentId: 'not-a-uuid',
          reversalDate: '2026-04-15',
          reason: 'Valid reason here',
          idempotencyKey: 'cmd-rev-004',
        }),
      ).toThrow();
    });

    it('rejects missing idempotency key', () => {
      expect(() =>
        reversePaymentSchema.parse({
          paymentId: 'a0000000-0000-0000-0000-000000000001',
          reversalDate: '2026-04-15',
          reason: 'Valid reason here',
          idempotencyKey: '',
        }),
      ).toThrow();
    });
  });

  describe('sanitizeCsvCell & toCsv formula injection mitigation (CWE-1236)', () => {
    it('prepends single quote to cells starting with dangerous characters (=, +, -, @, \\t, \\r)', () => {
      expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(sanitizeCsvCell('+12345cmd')).toBe("'+12345cmd");
      expect(sanitizeCsvCell('-2+3+cmd|')).toBe("'-2+3+cmd|");
      expect(sanitizeCsvCell('@IMPORT')).toBe("'@IMPORT");
      expect(sanitizeCsvCell('\tTabPrefix')).toBe("'\tTabPrefix");
      // \r triggers both formula prefix and CSV wrapping because of carriage return
      expect(sanitizeCsvCell('\rReturnPrefix')).toBe("\"'\rReturnPrefix\"");
    });

    it('preserves valid negative and positive numbers as numbers without prepending quotes', () => {
      expect(sanitizeCsvCell('-500')).toBe('-500');
      expect(sanitizeCsvCell('-125000.50')).toBe('-125000.50');
      expect(sanitizeCsvCell('+500')).toBe('+500');
      expect(sanitizeCsvCell('+1000.25')).toBe('+1000.25');
      expect(sanitizeCsvCell('150000')).toBe('150000');
    });

    it('handles null, undefined and normal string safely', () => {
      expect(sanitizeCsvCell(null)).toBe('');
      expect(sanitizeCsvCell(undefined)).toBe('');
      expect(sanitizeCsvCell('Acme Corp Loan 1')).toBe('Acme Corp Loan 1');
      expect(sanitizeCsvCell('Borrower Payment Reference #402')).toBe('Borrower Payment Reference #402');
    });

    it('escapes quotes and wraps containing commas in toCsv', () => {
      const headers = ['Event Date', 'Counterparty', 'Description', 'Amount'];
      const rows = [
        ['2026-04-01', 'Sharma, Rahul', 'Monthly repayment', '10000.00'],
        ['2026-04-02', 'Dangerous "Co"', '=cmd|/C calc', '-500.00'],
      ];
      const csv = toCsv(headers, rows);
      const lines = csv.split('\r\n');

      expect(lines[0]).toBe('Event Date,Counterparty,Description,Amount');
      expect(lines[1]).toBe('2026-04-01,"Sharma, Rahul",Monthly repayment,10000.00');
      expect(lines[2]).toBe('2026-04-02,"Dangerous ""Co""",\'=cmd|/C calc,-500.00');
    });
  });
});
