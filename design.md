Here’s a comprehensive `design.md` file. You can drop it straight into your project’s `docs/` folder.

---

```markdown
# Design Specification – Multi‑Tenant E‑Commerce SaaS

## 1. Brand Identity & Core Principles
- **Product Name:** MultiStore (placeholder)
- **Tone:** Modern, trustworthy, minimal, conversion‑focused.
- **Design Philosophy:**
  - Clarity over decoration.
  - Consistent spacing (8‑point grid system).
  - Mobile‑first layout, progressively enhanced for larger screens.
  - Clear visual hierarchy to guide the user from browsing to checkout.
  - Store owners can inject their own brand colour; all other system elements remain neutral.

---

## 2. Visual Foundation

### 2.1 Colour Palette

| Role                | Hex       | Tailwind Class (custom) |
|---------------------|-----------|-------------------------|
| **Primary (platform)** | `#4F46E5` | `primary` |
| Primary‑dark        | `#4338CA` | `primary-dark` |
| Primary‑light       | `#A5B4FC` | `primary-light` |
| Surface (white)     | `#FFFFFF` | default bg‑white |
| Background (light)  | `#F9FAFB` | bg‑gray‑50 |
| Text primary        | `#111827` | text‑gray‑900 |
| Text secondary      | `#6B7280` | text‑gray‑500 |
| Success             | `#10B981` | text‑emerald‑500 |
| Warning             | `#F59E0B` | text‑amber‑500 |
| Danger              | `#EF4444` | text‑red‑500 |
| Border              | `#E5E7EB` | border‑gray‑200 |

**Store‑specific theming:** Each store can override the primary colour via `store.theme_color`. Use CSS custom properties:
```css
:root {
  --color-primary: <%= store.theme_color || '#4F46E5' %>;
}
```

### 2.2 Typography
- **Font Family:** System stack – `Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, sans-serif (loaded via CDN).
- **Scale (Tailwind arbitrary values):**
  - `text-xs` → 0.75rem / line‑height 1rem
  - `text-sm` → 0.875rem / 1.25rem
  - `text-base` → 1rem / 1.5rem
  - `text-lg` → 1.125rem / 1.75rem
  - `text-xl` → 1.25rem / 1.75rem
  - `text-2xl` → 1.5rem / 2rem
  - `text-3xl` → 1.875rem / 2.25rem
  - `text-4xl` → 2.25rem / 2.5rem
- **Weights:** Regular (400), Medium (500), Semibold (600), Bold (700).

### 2.3 Spacing & Layout
- Base unit: 4px = `1` in Tailwind spacing scale.
- Page gutters: `px-4` (16px) mobile → `px-6` (24px) tablet → `px-8` (32px) desktop.
- Section vertical padding: `py-12` mobile → `py-20` desktop.
- Card padding: `p-6`.
- Form elements: `py-2 px-3`.

---

## 3. Iconography
- Use **Heroicons** (v2) – Outline style for UI, Solid for highlights.
- Import via SVG sprite or individual inline SVGs.
- Size: `w-5 h-5` for navigation/buttons, `w-6 h-6` for larger actions.

---

## 4. Component Library

### 4.1 Buttons
- **Primary:** `bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark shadow-sm transition-colors`
- **Secondary:** `bg-white text-gray-700 border border-gray-300 hover:bg-gray-50`
- **Danger:** `bg-red-500 text-white hover:bg-red-600`
- **Sizes:** `sm` (py-1 px-3 text-sm), `md` (default), `lg` (py-3 px-5 text-lg)
- **Disabled state:** `opacity-50 cursor-not-allowed`
- **Loading state:** Show spinner inside button, hide text.

### 4.2 Form Inputs
- Text input / textarea / select: `w-full rounded-lg border-gray-300 shadow-sm focus:border-primary focus:ring focus:ring-primary-light focus:ring-opacity-50 px-3 py-2`
- Label: `block text-sm font-medium text-gray-700 mb-1`
- Error message: `text-sm text-red-500 mt-1`
- Checkbox: `rounded border-gray-300 text-primary focus:ring-primary`

### 4.3 Cards
- Default: `bg-white rounded-xl shadow-sm border border-gray-100 p-6`
- Product card (storefront): `group cursor-pointer rounded-lg overflow-hidden hover:shadow-md transition-shadow`
  - Image area: `aspect-square bg-gray-100`
  - Info area: `p-4`

### 4.4 Navigation Bars
- **Storefront Header:** `sticky top-0 z-50 bg-white border-b border-gray-100 py-4 px-4 md:px-6 flex items-center justify-between`.
  - Logo (store name or uploaded logo) – left.
  - Nav links (Home, Products) – centre, hidden on mobile behind hamburger.
  - Right: Cart icon (with badge), Account menu.
- **Admin Sidebar:** `fixed inset-y-0 left-0 w-64 bg-gray-900 text-white p-6 flex flex-col`, collapsible to a `w-16` icon‑only sidebar on mobile via hamburger button.

### 4.5 Modals
- Centred overlay: `fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50`
- Modal box: `bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4`
- Header, body, footer with actions.

### 4.6 Toast Notifications
- Position: `fixed bottom-4 right-4 z-50`
- Appearance: `bg-white border border-gray-200 shadow-lg rounded-lg p-4 max-w-sm`
- Success: green left border, icon.
- Error: red left border.
- Auto‑dismiss after 3 seconds.

### 4.7 Tables (Admin)
- Container: `overflow-x-auto bg-white rounded-xl shadow-sm border`
- Table: `min-w-full divide-y divide-gray-200`
- Header: `bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider`
- Row: `hover:bg-gray-50`
- Cell: `px-6 py-4 whitespace-nowrap text-sm`

### 4.8 Empty States
- Centred box: `flex flex-col items-center justify-center py-12 text-gray-400`
- Illustration (use heroicons cloud/package icons), title, description, CTA button.

---

## 5. Page Layouts & Wireframe Descriptions

### 5.1 Platform Landing (`platform/index.ejs`)
```
+--------------------------------------------------+
| Header: [Logo] ... [Sign In] [Get Started]       |
+--------------------------------------------------+
| Hero (center)                                    |
|   H1: Launch your online store in minutes        |
|   Subtext                                        |
|   CTA button                                     |
+--------------------------------------------------+
| Features: 3 cards in a row (1-col mobile)        |
+--------------------------------------------------+
| Pricing: 3 columns (stack on mobile)            |
|   Toggle Monthly / Yearly                        |
+--------------------------------------------------+
| Footer                                          |
+--------------------------------------------------+
```

### 5.2 Store Admin Dashboard Layout
```
+----------------------------------------------------------+
| Sidebar (left)         | Top bar: store name, owner email|
|  - Dashboard           +---------------------------------+
|  - Products            |                                 |
|  - Orders              |  Dashboard Content              |
|  - Settings            |  (stats cards, recent orders)   |
|  - Domain              |                                 |
|  - Logout              |                                 |
+------------------------+---------------------------------+
```
Mobile: Sidebar hidden, hamburger top‑left toggles an overlay sidebar.

### 5.3 Public Storefront
- Header (sticky) with store logo, nav, cart badge.
- Main content area.
- Footer (privacy, etc.).
- Global cart slide‑out panel (right‑side overlay, width 400px, shadows).

### 5.4 Product Grid & Detail
- Grid: 2 cols mobile, 3 tablet, 4 desktop. Each card: image, name, price, add‑to‑cart button.
- Detail: Left side image placeholder with thumbnails below. Right side: name, price, short description, quantity selector, Add to Cart button. Out‑of‑stock state: button disabled, "Out of Stock" badge.

### 5.5 Checkout Flow
- Two columns: left (shipping address + card placeholder) 2/3 width, right (order summary) 1/3. Stack on mobile (order summary first, address below).
- "Place Order" button at bottom with loading state.

---

## 6. Store Theming Implementation
Every storefront renders a dynamic `<style>` block in `<head>` using `store.theme_color`:
```html
<style>
  :root {
    --color-primary: <%= store.theme_color || '#4F46E5' %>;
  }
  .text-primary { color: var(--color-primary); }
  .bg-primary { background-color: var(--color-primary); }
  .border-primary { border-color: var(--color-primary); }
  .ring-primary { --tw-ring-color: var(--color-primary); }
  .hover\:bg-primary-dark:hover {
    background-color: <%= adjustColor(store.theme_color, -20) %>;
  }
</style>
```
All buttons, links, and focus rings use these utility classes.

---

## 7. Responsive Breakpoints
| Breakpoint | Min Width | Design Adjustments |
|------------|-----------|---------------------|
| **Mobile** | < 640px (default) | Single column, hamburger nav, stacked cards, full‑width forms |
| **Tablet** | 640px (`sm:`) | Two columns in grids, side‑by‑side forms, header links visible |
| **Desktop** | 1024px (`lg:`) | Admin sidebar always visible, product grids with 4 columns, wider content max‑width 1280px |

Use `mx-auto max-w-7xl` containers for main content.

---

## 8. Interaction & Micro‑interactions
- **Add to Cart:** Button briefly shows checkmark icon, cart count badge animates (scale up then down).
- **Modal:** Fade in (opacity 0 → 1, transition 200ms). Backdrop click closes.
- **Toast:** Slide in from right (translate-x-100 → 0), fade out after 3s.
- **Form validation:** Red border appears on blur if invalid, error text with shake effect.
- **Hover:** Buttons and cards scale slightly (scale-105) with smooth transition.
- **Loading states:** Spinner icon (Heroicons `arrow-path` with `animate-spin`).

---

## 9. Accessibility (a11y)
- All interactive elements must be keyboard‑accessible (`tabindex`, `role`).
- Use proper heading hierarchy (h1 → h2 etc.).
- Forms must have `<label>` elements explicitly linked to inputs.
- Colour contrast ratio ≥ 4.5:1 for normal text.
- Focus rings visible (use `ring-2 ring-primary ring-offset-2` on interactive elements).
- Modals trap focus while open, close on Escape.
- Cart slide‑out receives focus when opened, aria‑label for cart count.

---

## 10. Assets & Delivery
- **Tailwind Config** includes `primary` colour overrides.
- All SVGs inlined for Heroicons.
- No custom fonts except Inter from CDN.
- Final output: EJS templates with inline styles where necessary (for dynamic theming).
```

