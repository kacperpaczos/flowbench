#!/usr/bin/env bash
# n8n: wezel `Lista produktow` (set, mode=raw, caly dokument zamowienia jako jsonOutput).
# Przeniesienie 1:1 - zrodlo juz bylo jednym dokumentem JSON.
#
# UWAGA o precyzji: w definicji n8n tekst ma "unitPrice": 129.50 i 59.00, ale wykonanie
# zapisalo 129.5 i 59 - JSON nie przechowuje zer koncowych. Odtwarzamy stan PO wykonaniu.
set -euo pipefail
echo "lista: emituje zamowienie ZAM-2026-001" >&2
jq -cn '{elementy: [{
  orderId: "ZAM-2026-001",
  currency: "PLN",
  items: [
    {sku: "P-001", name: "Klawiatura mechaniczna", unitPrice: 349.99, quantity: 1},
    {sku: "P-002", name: "Mysz bezprzewodowa",     unitPrice: 129.5,  quantity: 2},
    {sku: "P-003", name: "Podkladka pod mysz XL",  unitPrice: 59,     quantity: 3}
  ]
}]}'
