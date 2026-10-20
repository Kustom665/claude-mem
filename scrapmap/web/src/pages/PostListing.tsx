import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.ts';
import type { Community, GeocodeResult, Material, MaterialsResponse } from '../api/types.ts';
import { useAuth } from '../state/auth.tsx';
import { AddressSearch } from '../components/AddressSearch.tsx';
import { MapView } from '../components/MapView.tsx';
import { EstimateNote, ErrorNote, Field, Spinner, Toggle } from '../components/ui.tsx';
import { money, perPound } from '../lib/format.ts';

interface Line {
  materialKey: string;
  weightLbs: string;
  notes: string;
}

const emptyLine = (): Line => ({ materialKey: '', weightLbs: '', notes: '' });

export function PostListing() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState<MaterialsResponse | null>(null);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [step, setStep] = useState(0);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [address, setAddress] = useState<Partial<GeocodeResult>>({});
  const [pickupNotes, setPickupNotes] = useState('');
  const [curbside, setCurbside] = useState(false);
  const [helpNeeded, setHelpNeeded] = useState(false);
  const [priceType, setPriceType] = useState<'free' | 'obo' | 'firm'>('free');
  const [priceDollars, setPriceDollars] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    api.materials().then(setCatalog).catch(() => setError('Could not load the material list.'));
    api
      .communities({ mine: '1' })
      .then((data) => setCommunities(data.communities))
      .catch(() => setCommunities([]));
  }, []);

  useEffect(() => {
    if (!point && user?.homeLat != null && user.homeLon != null) {
      setPoint([user.homeLat, user.homeLon]);
    }
  }, [user, point]);

  const materialsByKey = useMemo(
    () => new Map((catalog?.materials ?? []).map((material) => [material.key, material])),
    [catalog],
  );

  /**
   * Value is recomputed locally as the user types rather than round-tripping to
   * the server, so the number moves the instant a weight changes. The server
   * recalculates authoritatively on submit.
   */
  const estimate = useMemo(() => {
    let totalCents = 0;
    let totalLbs = 0;
    const rows: { material: Material; lbs: number; cents: number }[] = [];

    for (const line of lines) {
      const material = materialsByKey.get(line.materialKey);
      const lbs = Number.parseFloat(line.weightLbs);
      if (!material || !Number.isFinite(lbs) || lbs <= 0) continue;
      const cents = Math.round(lbs * material.estimatedUsdPerLb * 100);
      totalCents += cents;
      totalLbs += lbs;
      rows.push({ material, lbs, cents });
    }

    return { totalCents, totalLbs, rows };
  }, [lines, materialsByKey]);

  const validLines = lines.filter(
    (line) => line.materialKey && Number.parseFloat(line.weightLbs) > 0,
  );

  const canContinue = [
    title.trim().length >= 4 && validLines.length > 0,
    point !== null,
    true,
  ];

  async function submit() {
    if (!point) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const { listing } = await api.createListing({
        title: title.trim(),
        description: description.trim(),
        priceType,
        priceCents:
          priceType === 'free' ? 0 : Math.round(Number.parseFloat(priceDollars || '0') * 100),
        lat: point[0],
        lon: point[1],
        addressLine: address.addressLine ?? null,
        city: address.city ?? null,
        region: address.region ?? null,
        postalCode: address.postalCode ?? null,
        pickupNotes: pickupNotes.trim(),
        curbside,
        helpNeeded,
        communityId: communityId || null,
        materials: validLines.map((line) => ({
          materialKey: line.materialKey,
          weightLbs: Number.parseFloat(line.weightLbs),
          notes: line.notes.trim(),
        })),
      });

      // Photos upload after the listing exists, one request each.
      for (const file of photos) {
        await api.uploadPhoto(listing.id, file).catch(() => undefined);
      }

      navigate(`/listing/${listing.id}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (caught.fields) setFieldErrors(caught.fields);
        // A rejected listing is almost always a step-one problem.
        if (caught.code === 'bad_request' || caught.fields) setStep(0);
      } else {
        setError('Something went wrong posting that.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!catalog) return <Spinner label="Loading materials" />;

  const steps = ['What have you got?', 'Where is it?', 'Pickup details'];

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_20rem]">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Post your scrap</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Tell us roughly what you have and where. A local scrapper will come take it — usually free,
          and usually within a day or two.
        </p>

        <ol className="mt-5 mb-6 flex gap-2">
          {steps.map((label, index) => (
            <li key={label} className="flex-1">
              <button
                type="button"
                onClick={() => index <= step && setStep(index)}
                disabled={index > step}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                  index === step
                    ? 'border-copper-600 bg-copper-950/40 text-copper-200'
                    : index < step
                      ? 'border-zinc-700 bg-ink-850 text-zinc-400 hover:border-zinc-600'
                      : 'border-zinc-800 bg-ink-900 text-zinc-600'
                }`}
              >
                <span className="block text-[10px] tracking-wide uppercase opacity-70">
                  Step {index + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        {error ? <ErrorNote message={error} /> : null}

        {step === 0 ? (
          <div className="mt-4 space-y-4">
            <Field label="Title" required error={fieldErrors.title}>
              <input
                className="field"
                value={title}
                maxLength={120}
                placeholder="e.g. Copper pipe and brass fittings from a bathroom remodel"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            <Field
              label="Description"
              hint="What condition is it in? Anything a scrapper should know before driving over?"
            >
              <textarea
                className="field min-h-28"
                value={description}
                maxLength={4000}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>

            <div>
              <p className="field-label">What is in the pile?</p>
              <p className="mb-2 text-xs text-zinc-500">
                Rough weights are fine. Not sure what something is? Pick “Mixed / Unsorted” and add
                a photo — scrappers are good at identifying it.
              </p>

              <div className="space-y-2">
                {lines.map((line, index) => {
                  const material = materialsByKey.get(line.materialKey);
                  return (
                    <div key={index} className="card p-3">
                      <div className="flex flex-wrap gap-2">
                        <select
                          className="field flex-1 min-w-48"
                          value={line.materialKey}
                          onChange={(event) => {
                            const next = [...lines];
                            next[index] = { ...line, materialKey: event.target.value };
                            setLines(next);
                          }}
                        >
                          <option value="">Choose a material…</option>
                          {catalog.categories.map((category) => (
                            <optgroup key={category.key} label={category.label}>
                              {catalog.materials
                                .filter((item) => item.category === category.key)
                                .map((item) => (
                                  <option key={item.key} value={item.key}>
                                    {item.name}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                        </select>

                        <div className="flex items-center gap-1">
                          <input
                            className="field w-24"
                            type="number"
                            min="0"
                            step="0.5"
                            inputMode="decimal"
                            placeholder="lbs"
                            value={line.weightLbs}
                            onChange={(event) => {
                              const next = [...lines];
                              next[index] = { ...line, weightLbs: event.target.value };
                              setLines(next);
                            }}
                          />
                          <span className="text-xs text-zinc-500">lbs</span>
                        </div>

                        {lines.length > 1 ? (
                          <button
                            type="button"
                            className="btn-ghost px-2"
                            onClick={() => setLines(lines.filter((_, i) => i !== index))}
                            aria-label="Remove this material"
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>

                      {material ? (
                        <div className="mt-2 rounded-lg bg-ink-850 p-2.5 text-xs">
                          <p className="text-zinc-400">{material.description}</p>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-semibold text-copper-300">
                              about {perPound(material.estimatedUsdPerLb)}
                            </span>
                            <span className="text-zinc-600">
                              {material.magnetic ? 'sticks to a magnet' : 'not magnetic'}
                            </span>
                          </p>
                          {material.upgradeTip ? (
                            <p className="mt-1.5 text-amber-300/80">💡 {material.upgradeTip}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className="btn-secondary mt-2"
                onClick={() => setLines([...lines, emptyLine()])}
              >
                + Add another material
              </button>
            </div>

            <details className="card p-3 text-sm">
              <summary className="cursor-pointer font-medium text-zinc-300">
                No scale? Use these rough weights
              </summary>
              <ul className="mt-2 grid gap-1 text-xs text-zinc-500 sm:grid-cols-2">
                {catalog.weightHints.map((hint) => (
                  <li key={hint.label} className="flex justify-between gap-2">
                    <span>{hint.label}</span>
                    <span className="shrink-0 text-zinc-400">≈ {hint.lbs} lbs</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mt-4 space-y-4">
            <Field
              label="Pickup address"
              required
              hint="Only you and the scrapper you accept will see the exact address. Everyone else sees an approximate pin."
            >
              <AddressSearch
                autoFocus
                onSelect={(result) => {
                  setPoint([result.lat, result.lon]);
                  setAddress(result);
                }}
              />
            </Field>

            <div className="h-80 overflow-hidden rounded-xl border border-zinc-800">
              <MapView
                center={point ?? [39.9612, -82.9988]}
                zoom={point ? 16 : 11}
                pickedPoint={point}
                onPick={(lat, lon) => setPoint([lat, lon])}
              />
            </div>
            <p className="text-xs text-zinc-500">
              Tap the map to move the pin if the address landed in the wrong spot.
            </p>

            {communities.length > 0 ? (
              <Field label="Share with a group" hint="Optional — posts also show on the public map.">
                <select
                  className="field"
                  value={communityId}
                  onChange={(event) => setCommunityId(event.target.value)}
                >
                  <option value="">Just the public map</option>
                  {communities.map((community) => (
                    <option key={community.id} value={community.id}>
                      {community.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 space-y-4">
            <Field
              label="Pickup notes"
              hint="Where exactly is it? Gate codes, which side of the house, when you are around."
            >
              <textarea
                className="field min-h-24"
                value={pickupNotes}
                maxLength={1000}
                placeholder="Stacked behind the garage. Come any time, no need to knock."
                onChange={(event) => setPickupNotes(event.target.value)}
              />
            </Field>

            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle
                checked={curbside}
                onChange={setCurbside}
                label="It is curbside"
                description="Anyone can grab it without contacting you first."
              />
              <Toggle
                checked={helpNeeded}
                onChange={setHelpNeeded}
                label="Heavy — bring help"
                description="You cannot assist with loading."
              />
            </div>

            <Field label="Price">
              <div className="flex flex-wrap gap-2">
                {(['free', 'obo', 'firm'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPriceType(option)}
                    className={`btn ${
                      priceType === option
                        ? 'bg-copper-500 text-white'
                        : 'border border-zinc-700 bg-ink-850 text-zinc-300'
                    }`}
                  >
                    {option === 'free' ? 'Free — just take it' : option === 'obo' ? 'Open to offers' : 'Fixed price'}
                  </button>
                ))}
              </div>
            </Field>

            {priceType !== 'free' ? (
              <Field
                label="Asking price"
                hint={
                  estimate.totalCents > 0
                    ? `A yard would pay roughly ${money(
                        estimate.totalCents,
                      )} for this. Scrappers also cover fuel and time, so asking under that moves faster.`
                    : undefined
                }
              >
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">$</span>
                  <input
                    className="field w-32"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={priceDollars}
                    onChange={(event) => setPriceDollars(event.target.value)}
                  />
                </div>
              </Field>
            ) : null}

            <Field
              label="Photos"
              hint="Optional, but a photo roughly doubles the chance someone drives over. Up to 8."
            >
              <input
                className="field"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) =>
                  setPhotos(Array.from(event.target.files ?? []).slice(0, 8))
                }
              />
              {photos.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {photos.map((file) => (
                    <img
                      key={file.name + file.size}
                      src={URL.createObjectURL(file)}
                      alt=""
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                  ))}
                </div>
              ) : null}
            </Field>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0}
          >
            Back
          </button>

          {step < 2 ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setStep((value) => value + 1)}
              disabled={!canContinue[step]}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void submit()}
              disabled={submitting || !point || validLines.length === 0}
            >
              {submitting ? 'Posting…' : 'Post it'}
            </button>
          )}
        </div>
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-zinc-300">What it is worth</h2>
          <p className="mt-3 text-3xl font-bold text-copper-300">
            {money(estimate.totalCents)}
          </p>
          <p className="text-xs text-zinc-500">
            {estimate.totalLbs > 0 ? `${estimate.totalLbs.toFixed(0)} lbs total` : 'Add materials to see an estimate'}
          </p>

          {estimate.rows.length > 0 ? (
            <ul className="mt-4 space-y-2 border-t border-zinc-800 pt-3 text-xs">
              {estimate.rows.map((row) => (
                <li key={row.material.key} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-zinc-400">
                    {row.material.name}
                    <span className="text-zinc-600"> · {row.lbs} lb</span>
                  </span>
                  <span className="shrink-0 font-medium text-zinc-300">{money(row.cents)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 border-t border-zinc-800 pt-3">
            <p className="text-xs text-zinc-500">
              Copper index:{' '}
              <span className="font-medium text-zinc-300">
                {perPound(catalog.prices.copper.usdPerLb)}
              </span>{' '}
              {catalog.prices.copper.isLive ? (
                <span className="text-emerald-400">live</span>
              ) : (
                <span className="text-amber-400">offline estimate</span>
              )}
            </p>
            <EstimateNote className="mt-2" />
          </div>
        </div>

        <div className="card mt-3 p-4 text-xs text-zinc-500">
          <p className="font-semibold text-zinc-400">Not accepted on ScrapMap</p>
          <p className="mt-1.5">
            {catalog.prohibitedItems.join(', ')}. These are commonly tied to metal theft and are
            restricted or illegal to resell in many places.
          </p>
        </div>
      </aside>
    </div>
  );
}
