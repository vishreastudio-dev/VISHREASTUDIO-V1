# Calculation & Business Rules Specification
**System:** Vishrea Studio Business Management System  
**Date:** 17 November 2026  
**Document Version:** 1.0  

---

## 1. Inventory & Costing Calculations

### A. Cost Per Unit
The landed cost per unit includes both the base purchase price per piece and the distributed courier freight charges incurred to receive the batch:

$$\text{Cost Per Unit} = \text{Purchase Price Per Piece} + \left( \frac{\text{Total Courier Charge}}{\text{Purchase Quantity}} \right)$$

- **Edge Case (Zero Quantity):** If $\text{Purchase Quantity} = 0$, $\text{Cost Per Unit} = \text{Purchase Price Per Piece}$.
- **Rounding:** Rounded to two decimal places (half-up) in currency representations.

### B. Units Sold
Units sold for a product are derived strictly from valid completed or active sales:

$$\text{Units Sold} = \sum \text{quantity in } \text{order\_items}$$
$$\text{WHERE } \text{orders.payment\_status} \neq \text{'failed'} \text{ AND } \text{orders.payment\_status} \neq \text{'cancelled'} \text{ AND } \text{orders.status} \neq \text{'cancelled'}$$

- Excluded orders: cancelled orders, expired reservations, and refunded items do not contribute to positive units sold.

### C. Stock Left
$$\text{Stock Left} = \max(0, \text{Purchase Quantity} - \text{Units Sold})$$

- Displayed stock is constrained to never display a negative number ($\ge 0$).
- When multi-variant products exist, variant stock is tracked per size variant, and total product stock left is the sum of variant stock quantities.

### D. Stock Value
$$\text{Stock Value} = \text{Stock Left} \times \text{Cost Per Unit}$$

- Represents the total capital tied up in unsold warehouse and studio inventory.

### E. Inventory Classification Rules & Priority
Every inventory piece is classified into one of four statuses:

1. **Low Stock:**
   $$\text{Stock Left} \le \text{Low-Stock Threshold}$$
   *(Default threshold is 2 units if not customized on the piece).*

2. **Fast Moving:**
   $$\text{Purchase Quantity} > 0 \quad \text{AND} \quad \text{Units Sold} > (\text{Purchase Quantity} \times 0.50)$$
   *(More than 50% of the purchased batch has sold).*

3. **Dead Stock:**
   $$\text{Purchase Quantity} > 0 \quad \text{AND} \quad \text{Units Sold} = 0$$
   *(Positive stock purchased but zero units sold since arrival).*

4. **Normal Stock:**
   Pieces that do not trigger Low Stock, Fast Moving, or Dead Stock.

**Priority Rule (Non-negotiable):**
$$\mathbf{Low\ Stock} \succ \mathbf{Fast\ Moving} \succ \mathbf{Dead\ Stock}$$
If a piece has sold over 50% of its batch but remaining stock is $\le$ threshold, its status is **Low Stock** (alerting staff to re-order immediately).

---

## 2. Sales & Counter POS Calculations

### A. Line Amount
For each item in a sale:
$$\text{Line Amount} = \text{Quantity} \times \text{Sale Rate}$$

### B. Subtotal
$$\text{Subtotal} = \sum_{i=1}^{n} \text{Line Amount}_i$$

### C. Final Amount
$$\text{Final Amount} = \max(0, \text{Subtotal} - \text{Discount})$$

- **Validation:** Discount cannot be negative ($\text{Discount} \ge 0$).
- **Validation:** Discount cannot exceed Subtotal ($\text{Discount} \le \text{Subtotal}$).

### D. Amount Due
$$\text{Amount Due} = \max(0, \text{Final Amount} - \text{Amount Paid})$$

- **Validation:** Amount Paid cannot be negative ($\text{Amount Paid} \ge 0$).
- **Validation:** Amount Paid cannot exceed Final Amount ($\text{Amount Paid} \le \text{Final Amount}$).

### E. Payment Status Transition
The payment status is automatically and consistently derived from the financial balance:
- If $\text{Amount Paid} \ge \text{Final Amount}$: $\text{payment\_status} = \mathbf{'paid'}$
- If $\text{Amount Paid} > 0 \text{ AND } \text{Amount Paid} < \text{Final Amount}$: $\text{payment\_status} = \mathbf{'partially\_paid'}$
- If $\text{Amount Paid} = 0$: $\text{payment\_status} = \mathbf{'due'}$ (or $\mathbf{'pending'}$)

### F. Estimated Profit
$$\text{Estimated Profit} = \text{Final Amount} - \sum \text{Estimated Cost of Items Sold}$$

- **Discount Treatment:** Discounts are deducted directly from gross revenue, meaning estimated profit accurately reflects net profit after discounting.

---

## 3. Customer Loyalty & Stamp Cycle Model

### A. Cycle Structure
- Every six (6) qualifying purchases form **one complete cycle**.
- A qualifying purchase is a distinct paid, non-cancelled order associated with the customer profile.

### B. Mathematical Formulas
Let $N$ be the customer's lifetime qualifying purchase count:

$$\text{Current Stamp} = N \pmod 6 \quad (\text{values: } 0, 1, 2, 3, 4, 5)$$
$$\text{Completed Cycles} = \left\lfloor \frac{N}{6} \right\rfloor$$

### C. Eligibility & Reset Rules
1. **Stamp Accumulation (Stamps 1 to 4):**
   Purchases 1, 2, 3, 4 increment the stamp counter towards the reward.
2. **Reward Eligibility (Stamp 5):**
   When $\text{Current Stamp} = 5$ (i.e., after 5 purchases in the current cycle):
   $$\mathbf{Eligible\ for\ 50\%\ off\ next\ purchase} = \mathbf{TRUE}$$
3. **Manual Entry Policy:**
   - The CRM and Sales form **only identify eligibility** and alert the salesperson.
   - The system **must NOT** automatically apply or force the 50% discount.
   - Staff must manually enter the agreed discount amount in the sale form.
4. **Cycle Reset (Purchase 6):**
   - When the 6th purchase is completed, $(N \pmod 6)$ becomes $0$.
   - The stamp card **resets to 0 stamps**, and cycle count increments by 1.
   - The customer begins their next cycle towards the next reward.
5. **Integrity & Reversal:**
   Because the status is derived deterministically from the count of valid paid orders, deleting or cancelling a sale immediately decrements $N$ and automatically restores the correct previous stamp status and eligibility.

---

## 4. Procurement & Purchase Order Calculations

### A. PO Item Line Total
$$\text{Line Total} = \text{Quantity} \times \text{Unit Cost}$$

### B. PO Grand Total
$$\text{Grand Total} = \sum \text{Line Totals} + \text{Courier Charges}$$

### C. Fulfilment Freight Allocation
When a purchase order is fulfilled, courier freight is distributed proportionally per unit:

$$\text{Courier Freight Per Unit} = \frac{\text{Courier Charges}}{\sum \text{Item Quantities}}$$
$$\text{Cost Per Unit for Item } j = \text{Unit Cost}_j + \text{Courier Freight Per Unit}$$

- Inventory records created upon fulfilment inherit this exact $\text{Cost Per Unit}$ as their authoritative `cost_price_inr`.
- **Atomicity:** Fulfilment happens inside an isolated database transaction. If inventory creation fails, the PO status rollback is complete.
- **Idempotency:** A PO with $\text{status} = \mathbf{'fulfilled'}$ rejects duplicate fulfilment attempts.

---

## 5. Vendor Summary Metrics

For each vendor:
1. **Purchase Orders Served:**
   $$\text{POs Served} = \text{COUNT}(\text{purchase\_orders}) \quad \text{WHERE vendor\_id} = V.\text{id}$$
2. **Total Goods Purchased Value:**
   $$\text{Total Purchased} = \sum \text{grand\_total in } \text{purchase\_orders} \quad \text{WHERE vendor\_id} = V.\text{id}$$
3. **Estimated Sales Profit Generated:**
   $$\text{Vendor Profit} = \sum (\text{item\_total} - \text{item\_cost}) \quad \text{for all products supplied by } V.\text{id}$$
4. **Best-Selling Product:**
   The product associated with $V.\text{id}$ with the highest cumulative units sold.

---

## 6. Dashboard Aggregations & Retention Rate

### A. Average Order Value (AOV)
$$\text{AOV} = \frac{\text{Total Paid Order Revenue}}{\text{Total Paid Order Count}}$$
*(Orders with zero or negative total are excluded from the denominator to avoid skew).*

### B. Customer Retention Percentage
$$\text{Retention Rate} = \left( \frac{\text{Repeat Customers}}{\text{Total Purchasing Customers}} \right) \times 100$$
Where:
- $\text{Total Purchasing Customers}$ = Customers who have made at least 1 paid order.
- $\text{Repeat Customers}$ = Customers who have made $\ge 2$ paid orders.
- If $\text{Total Purchasing Customers} = 0$, $\text{Retention Rate} = 0.0\%$.

### C. Six-Month Rolling Revenue
Calculated using monthly calendar intervals:
$$\text{For month } m \in [0..5]: \quad \text{Revenue}_m = \sum \text{orders.total} \quad \text{WHERE } \text{payment\_status} = \text{'paid'}$$
$$\text{AND } \text{paid\_at} \ge \text{date\_trunc('month', now() - } m \text{ months)}$$
$$\text{AND } \text{paid\_at} < \text{date\_trunc('month', now() - } (m-1) \text{ months)}$$
