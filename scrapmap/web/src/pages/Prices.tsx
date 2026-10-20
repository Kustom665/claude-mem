import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.ts';
import type { MaterialsResponse } from '../api/types.ts';
import { CategoryBadge, EstimateNote, Spinner } from '../components/ui.tsx';
import { money, perPound } from '../lib/format.ts';

/**
 * The price page doubles as a field guide: what each grade is, where it turns up
 * in a house, how to tell it apart, and what prep moves it up a grade.
 */
export function Prices() {
  const [catalog, setCatalog] = useState<MaterialsResponse | null>(null);
  const [category, setCategory] = useState('');
  const [calcKey, setCalcKey] = useState('bare-bright');
  const [calcLbs, setCalcLbs] = useState('50');

  useEffect(() => {
    api.materials().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  const shown = useMemo(
    () =>
      (catalog?.materials ?? []).filter(
        (material) => !category || material.category === category,
      ),
    [catalog, category],
  );

  const calcMaterial = catalog?.materials.find((material) => material.key === calcKey);
  const calcTotal =
    calcMaterial && Number.parseFloat(calcLbs) > 0
      ? Math.round(Number.parseFloat(calcLbs) * calcMaterial.estimatedUsdPerLb * 100)
      : 0;

  if (!catalog) return <Spinner label="Loading prices" />;

  const { prices } = catalog;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-bold text-zinc-100">Scrap prices &amp; field guide</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Yards quote most grades as a percentage of the copper index. Here is where that index sits
        today and what each grade works out to.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[prices.copper, prices.aluminum, prices.steel].map((price) => (
          <div key={price.metal} className="card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs tracking-wide text-zinc-500 uppercase">{price.metal}</p>
              {price.isLive ? (
                <span className="chip bg-emerald-950 text-emerald-300">live</span>
              ) : (
                <span className="chip bg-amber-950 text-amber-300">estimate</span>
              )}
            </div>
            <p className="mt-1 text-2xl font-bold text-copper-300">{perPound(price.usdPerLb)}</p>
            <p className="text-[11px] text-zinc-600">
              {price.source} · {price.asOf}
              {price.changePct !== null ? (
                <span className={price.changePct >= 0 ? ' text-emerald-400' : ' text-red-400'}>
                  {' '}
                  {price.changePct >= 0 ? '▲' : '▼'} {Math.abs(price.changePct)}%
                </span>
              ) : null}
            </p>
          </div>
        ))}
      </div>

      {prices.freshness === 'fallback' ? (
        <p className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Live pricing is unreachable right now, so these are built-in baseline figures. Everything
          still works — the numbers are just less current than usual.
        </p>
      ) : null}

      <section className="card mt-6 p-4">
        <h2 className="text-sm font-semibold text-zinc-300">Quick calculator</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-48">
            <span className="field-label">Material</span>
            <select
              className="field"
              value={calcKey}
              onChange={(event) => setCalcKey(event.target.value)}
            >
              {catalog.categories.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {catalog.materials
                    .filter((material) => material.category === group.key)
                    .map((material) => (
                      <option key={material.key} value={material.key}>
                        {material.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="w-32">
            <span className="field-label">Pounds</span>
            <input
              className="field"
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={calcLbs}
              onChange={(event) => setCalcLbs(event.target.value)}
            />
          </label>

          <div className="pb-1">
            <p className="text-xs text-zinc-500">Estimated payout</p>
            <p className="text-2xl font-bold text-copper-300">{money(calcTotal)}</p>
          </div>
        </div>
        <EstimateNote className="mt-3" />
      </section>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategory('')}
          className={`chip border ${
            category === ''
              ? 'border-copper-600 bg-copper-950/60 text-copper-200'
              : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Everything
        </button>
        {catalog.categories.map((group) => (
          <button
            key={group.key}
            type="button"
            onClick={() => setCategory(group.key)}
            className={`chip border ${
              category === group.key
                ? 'border-copper-600 bg-copper-950/60 text-copper-200'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {group.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {shown.map((material) => (
          <article key={material.key} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-zinc-100">{material.name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <CategoryBadge category={material.category} label={material.categoryLabel} />
                  <span className="text-xs text-zinc-600">
                    {material.magnetic ? '🧲 sticks to a magnet' : 'not magnetic'}
                  </span>
                  {material.basis === 'copper' ? (
                    <span className="text-xs text-zinc-600">
                      ≈ {Math.round(material.yardPct * 100)}% of copper index
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="shrink-0 text-xl font-bold text-copper-300">
                {perPound(material.estimatedUsdPerLb)}
              </p>
            </div>

            <p className="mt-2.5 text-sm text-zinc-400">{material.description}</p>

            <p className="mt-2 text-xs text-zinc-500">
              <span className="text-zinc-400">Found in:</span> {material.foundIn.join(' · ')}
            </p>

            {material.upgradeTip ? (
              <p className="mt-2 rounded-lg bg-amber-950/30 px-3 py-2 text-xs text-amber-300/90">
                💡 {material.upgradeTip}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
