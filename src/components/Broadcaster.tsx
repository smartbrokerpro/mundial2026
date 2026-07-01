import { airsOnCHV } from "@/lib/data/chilevision";

// Marca pequeña de Chilevisión si el partido lo transmite ese canal.
export default function Broadcaster({
  home,
  away,
  stage,
  size = 13,
}: {
  home: string | null | undefined;
  away: string | null | undefined;
  stage?: string;
  size?: number;
}) {
  if (!airsOnCHV(home, away, stage)) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="tv-chv"
      src="/chilevision.svg"
      alt="Chilevisión"
      title="Transmite Chilevisión"
      style={{ height: size }}
    />
  );
}
