/** The event's sponsors, shown on every pass page. Logos live in public/sponsors (small JPEGs). */
const SPONSORS = [
  { name: 'S.S. Chains & Jewellers', logo: 'ss-chains-jewellers.jpg' },
  { name: 'Lyallpur', logo: 'lyallpur.jpg' },
  { name: 'Kultura', logo: 'kultura.jpg' },
  { name: 'ABS Great Security Service', logo: 'abs-security.jpg' },
  { name: 'Leyros Essence', logo: 'leyros.jpg' },
  { name: 'Wrapped by Binny', logo: 'wrapped-by-binny.jpg' },
  { name: 'Just Manage Events', logo: 'just-manage-events.jpg' },
  { name: 'Jimmy Mittal Photography', logo: 'jimmy-mittal-photography.jpg' },
  { name: 'Paiddy Events & Production', logo: 'paiddy-events.jpg' },
  { name: "Diva's Swagger", logo: 'divas-swagger.jpg' },
  { name: 'SK Robin', logo: 'sk-robin.jpg' },
];

export function Sponsors() {
  return (
    <section className="rounded-3xl bg-white p-6" aria-labelledby="sponsors-heading">
      <h2 id="sponsors-heading" className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        Our sponsors
      </h2>
      <ul className="mt-4 flex flex-wrap justify-center gap-2.5">
        {SPONSORS.map((sponsor) => (
          <li key={sponsor.logo} className="flex aspect-[3/2] w-[calc((100%-1.25rem)/3)] items-center justify-center overflow-hidden rounded-xl border border-zinc-100 bg-white p-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static logos, already sized */}
            <img
              src={`/sponsors/${sponsor.logo}`}
              alt={sponsor.name}
              loading="lazy"
              decoding="async"
              className="max-h-full max-w-full object-contain"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
