#!/usr/bin/env bash
# n8n: wezel `Policz sume zamowienia` (code): lineTotal per pozycja, subtotal, VAT 23%,
# total, itemCount, unitsTotal. Kolejnosc pol zachowana taka jak w n8n.
set -euo pipefail
: "${ZAMOWIENIE:?brak ZAMOWIENIE - krok musi miec depends na kroku publikujacym}"
echo "lista: sumuje zamowienie" >&2
printf '%s' "$ZAMOWIENIE" | jq -c '
  .elementy[0] as $o
  | ($o.items | map(. + {lineTotal: ((.unitPrice * .quantity) * 100 | round / 100)})) as $lines
  | {elementy: [
      {
        orderId:    $o.orderId,
        currency:   $o.currency,
        lines:      $lines,
        itemCount:  ($lines | length),
        unitsTotal: ($lines | map(.quantity) | add),
        subtotal:   (($lines | map(.lineTotal) | add) * 100 | round / 100),
        vatRate:    0.23
      }
      | . + {vat:   (.subtotal * .vatRate * 100 | round / 100)}
      | . + {total: ((.subtotal + .vat)    * 100 | round / 100)}
    ]}'
