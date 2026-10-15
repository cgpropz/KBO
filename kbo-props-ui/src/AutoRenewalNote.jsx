import { autoRenewalStatement } from './autoRenewal.js';

export default function AutoRenewalNote() {
  return (
    <p className="ff-checkout-note checkout-renewal" data-testid="auto-renewal">
      <strong>Auto-renewal. </strong>
      {autoRenewalStatement(import.meta.env)}
    </p>
  );
}
