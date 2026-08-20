import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { DEMO_SETS, demoDb, priceClassName, productsForSet, readBreak } from '@/lib/demo/state'

/*
 * The demo target. This page is pretending to be somebody else's shop, so it carries
 * none of the DOXA design system: plain semantic HTML, stable class names, one small
 * self contained stylesheet.
 *
 * The break renames one class and changes nothing else. `.price` becomes `.cost`, the
 * text, the layout and the 200 response all stay the same, so a human reading the page
 * sees nothing wrong. That is how this fails in the wild, and a break that looks broken
 * to a human proves nothing.
 *
 * Selectors the demo collector keys on: .product, .name, .price (breaks to .cost),
 * .sku, .stock.
 */

export const runtime = 'nodejs'
// Never prerendered. The flag is read on every request or the break button does nothing.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'Wickham Supply Co.',
  description: 'Packing and moving supplies, priced per unit.',
}

const SET_NAMES: Record<string, string> = {
  a: 'Boxes and cartons',
  b: 'Tape and labels',
  c: 'Protection and handling',
}

const STYLES = `
  body { background: #ffffff; color: #1a1a1a; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, sans-serif; font-size: 15px; line-height: 1.5; }
  .shop { max-width: 760px; margin: 0 auto; padding: 40px 20px 72px; }
  .shop-name { font-size: 24px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.01em; }
  .shop-note { color: #5f6368; margin: 0 0 24px; font-size: 14px; }
  .sets { list-style: none; display: flex; gap: 16px; padding: 0 0 20px; margin: 0 0 24px; border-bottom: 1px solid #e3e5e8; font-size: 14px; }
  .sets a { color: #1a5fb4; text-decoration: none; }
  .sets a:hover { text-decoration: underline; }
  .sets .current { font-weight: 600; color: #1a1a1a; }
  .set-name { font-size: 17px; font-weight: 600; margin: 0 0 16px; }
  .products { list-style: none; padding: 0; margin: 0; }
  .product { padding: 14px 0; border-bottom: 1px solid #eceef0; }
  .name { font-size: 15px; font-weight: 600; margin: 0 0 6px; }
  .details { display: flex; gap: 6px 24px; flex-wrap: wrap; margin: 0; font-size: 14px; }
  .label { color: #5f6368; margin: 0; }
  .label::after { content: ":"; }
  /* Both names are styled the same on purpose. The break must not be visible. */
  .price, .cost, .sku, .stock { margin: 0 16px 0 0; color: #1a1a1a; }
  .footer { margin-top: 32px; color: #5f6368; font-size: 13px; }
`

export default async function ShopSetPage({ params }: { params: Promise<{ set: string }> }) {
  const { set } = await params
  const products = productsForSet(set)
  if (!products) notFound()

  const priceClass = priceClassName(readBreak(demoDb()).broken)

  return (
    <>
      <style>{STYLES}</style>
      <div className="shop">
        <h1 className="shop-name">Wickham Supply Co.</h1>
        <p className="shop-note">Packing and moving supplies. Prices per unit, stock counted daily.</p>

        <nav>
          <ul className="sets">
            {DEMO_SETS.map((s) => (
              <li key={s}>
                {s === set ? (
                  <span className="current">{SET_NAMES[s]}</span>
                ) : (
                  <a href={`/demo/shop/${s}`}>{SET_NAMES[s]}</a>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <h2 className="set-name">{SET_NAMES[set]}</h2>
        <ul className="products">
          {products.map((p) => (
            <li className="product" key={p.sku}>
              <h3 className="name">{p.name}</h3>
              <dl className="details">
                <dt className="label">Price</dt>
                <dd className={priceClass}>{p.price}</dd>
                <dt className="label">SKU</dt>
                <dd className="sku">{p.sku}</dd>
                <dt className="label">In stock</dt>
                <dd className="stock">{p.stock}</dd>
              </dl>
            </li>
          ))}
        </ul>

        <p className="footer">Wickham Supply Co. Warehouse pickup Monday to Friday, 8am to 4pm.</p>
      </div>
    </>
  )
}
