import { ReconciliationResult } from "../domain/reconciliation";

export interface ReconciliationGateway {
  reconcile(): Promise<ReconciliationResult>;
}

export async function runReconciliation(
  gateway: ReconciliationGateway,
): Promise<ReconciliationResult> {
  return gateway.reconcile();
}
